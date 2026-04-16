import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { assertPlanAllows, PlanUpgradeRequired } from "@/lib/billing";
import { db } from "@/lib/db/client";
import { tenantSsoConfigs } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { RbacError, requireRole } from "@/lib/rbac";
import type { SsoProvider } from "@/lib/sso";

/**
 * Tenant SSO configuration endpoint.
 *
 * GET  -> current row (or null).
 * PUT  -> upsert.
 *
 * Both gated by `assertPlanAllows(ctx, 'sso')` (enterprise plan only) and
 * `requireRole(ctx, 'admin')`. Persisting a row with `enabled=true` is
 * allowed even though the provider SDK isn't installed: enabling toggles
 * the *intent* to use SSO. The actual login flow (not implemented in
 * this scaffold) will call `getSsoAdapter(provider).initiate(...)` which
 * throws `SsoNotConfigured` until an operator wires up the provider SDK
 * and env vars on their fork. When that happens, the response body for
 * the login route will surface `sso_provider_not_configured` (501), NOT
 * this PUT — we save the row so the UI can round-trip cleanly.
 */

const VALID_PROVIDERS: SsoProvider[] = ["workos", "clerk", "saml-generic"];

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    await assertPlanAllows(ctx, "sso");

    const [row] = await db
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, ctx.tenantId))
      .limit(1);

    return NextResponse.json({ config: row ?? null });
  } catch (err) {
    return mapError(err);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    await assertPlanAllows(ctx, "sso");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const provider = b.provider;
    const connectionId =
      typeof b.connectionId === "string" ? b.connectionId.trim() || null : null;
    const domain =
      typeof b.domain === "string"
        ? b.domain.trim().toLowerCase() || null
        : null;
    const enabled = b.enabled === true;

    if (
      typeof provider !== "string" ||
      !VALID_PROVIDERS.includes(provider as SsoProvider)
    ) {
      return NextResponse.json(
        { error: "invalid provider" },
        { status: 400 },
      );
    }

    const now = new Date();
    await db
      .insert(tenantSsoConfigs)
      .values({
        tenantId: ctx.tenantId,
        provider: provider as SsoProvider,
        connectionId,
        domain,
        enabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantSsoConfigs.tenantId,
        set: {
          provider: provider as SsoProvider,
          connectionId,
          domain,
          enabled,
          updatedAt: now,
        },
      });

    const [row] = await db
      .select()
      .from(tenantSsoConfigs)
      .where(eq(tenantSsoConfigs.tenantId, ctx.tenantId))
      .limit(1);

    return NextResponse.json({ config: row });
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): Response {
  if (err instanceof RbacError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof PlanUpgradeRequired) {
    return NextResponse.json(
      { error: "plan_upgrade_required", feature: err.feature },
      { status: 402 },
    );
  }
  if (err instanceof TenantAccessError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof Error) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  throw err;
}
