import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createKey,
  listKeys,
  type TenantApiKeyProvider,
} from "@/lib/db/tenant-api-keys";

const ALLOWED_PROVIDERS: TenantApiKeyProvider[] = [
  "anthropic",
  "openai",
  "gateway",
  "google",
  "xai",
];

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest): Promise<Response> {
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

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as {
      provider?: string;
      label?: string | null;
      key?: string;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!ALLOWED_PROVIDERS.includes(body.provider as TenantApiKeyProvider)) {
      return NextResponse.json(
        { error: "invalid provider" },
        { status: 400 },
      );
    }
    if (!body.key || typeof body.key !== "string" || body.key.length < 8) {
      return NextResponse.json(
        { error: "invalid key" },
        { status: 400 },
      );
    }
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
