import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantQuotas } from "@/lib/db/schema";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { getTenantQuotas } from "@/lib/quotas";
import { withRateLimit } from "@/lib/rate-limit";
import { checkBodySize } from "@/lib/validation";

/**
 * GET /api/tenant/quotas — return the tenant's effective quota row,
 * including the per-provider daily spend caps.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    const quotas = await getTenantQuotas(ctx.tenantId);
    return NextResponse.json({ quotas });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

const KNOWN_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "xai",
  "gateway",
]);

function sanitizeProviderCaps(
  raw: unknown,
): Record<string, number> | null | { error: string } {
  if (raw === null) return null;
  if (typeof raw !== "object") {
    return { error: "maxDailySpendByProvider must be an object or null" };
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const provider = key.trim().toLowerCase();
    if (!KNOWN_PROVIDERS.has(provider)) {
      return { error: `unknown provider: ${key}` };
    }
    if (value === null || value === undefined) {
      // Allow explicit nulls to delete a per-provider cap.
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { error: `invalid cap for ${provider}: must be a non-negative number (cents)` };
    }
    out[provider] = Math.floor(value);
  }
  return Object.keys(out).length === 0 ? null : out;
}

async function patchHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (ctx.role !== "owner") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const sizeErr = checkBodySize(req);
    if (sizeErr) return sizeErr;
    const body = (await req.json().catch(() => null)) as {
      maxDailySpendByProvider?: unknown;
    } | null;
    if (!body || !("maxDailySpendByProvider" in body)) {
      return NextResponse.json(
        { error: "maxDailySpendByProvider is required" },
        { status: 400 },
      );
    }
    const sanitized = sanitizeProviderCaps(body.maxDailySpendByProvider);
    if (sanitized && !Array.isArray(sanitized) && "error" in sanitized) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }
    const value = sanitized as Record<string, number> | null;

    // Upsert: if no row exists yet, the existing defaults apply for
    // every other column — we only override maxDailySpendByProvider.
    const [existing] = await db
      .select({ tenantId: tenantQuotas.tenantId })
      .from(tenantQuotas)
      .where(eq(tenantQuotas.tenantId, ctx.tenantId))
      .limit(1);

    if (existing) {
      await db
        .update(tenantQuotas)
        .set({ maxDailySpendByProvider: value, updatedAt: new Date() })
        .where(eq(tenantQuotas.tenantId, ctx.tenantId));
    } else {
      await db.insert(tenantQuotas).values({
        tenantId: ctx.tenantId,
        maxDailySpendByProvider: value,
      });
    }

    const quotas = await getTenantQuotas(ctx.tenantId);
    return NextResponse.json({ quotas });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const PATCH = withRateLimit(patchHandler, { category: "keys:write" });
