import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createKey,
  listKeys,
  type TenantApiKeyProvider,
} from "@/lib/db/tenant-api-keys";
import { withRateLimit, withReadRateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/validation";

const ALLOWED_PROVIDERS: TenantApiKeyProvider[] = [
  "anthropic",
  "openai",
  "gateway",
  "google",
  "xai",
];

const createKeySchema = z.object({
  provider: z.enum(["anthropic", "openai", "gateway", "google", "xai"]),
  label: z.string().max(100).nullable().optional(),
  key: z.string().min(8, "key must be at least 8 characters").max(2000),
});

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

async function getHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    const keys = await listKeys(ctx);
    return NextResponse.json({ keys });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

async function postHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { data: body, response } = await validateBody(req, createKeySchema);
    if (response) return response;
    const dto = await createKey(ctx, {
      provider: body.provider as TenantApiKeyProvider,
      label: body.label ?? null,
      plaintextKey: body.key,
      userId: ctx.userId,
    });
    // Never include plaintext in response.
    return NextResponse.json({ key: dto }, { status: 201 });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withReadRateLimit(getHandler);

export const POST = withRateLimit(postHandler, { category: "keys:write" });
