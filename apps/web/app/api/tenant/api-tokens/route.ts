import { NextResponse, type NextRequest } from "next/server";
import {
  requireScope,
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import {
  createToken,
  listTokens,
  type TokenScope,
} from "@/lib/db/tenant-api-tokens";

const SCOPES: TokenScope[] = ["read", "write", "admin"];

function canManageTokens(role: string): boolean {
  // Creating/revoking PATs is a tenant-admin action — owners and admins only.
  return role === "owner" || role === "admin";
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    // Reading the token list is itself sensitive (reveals hints, names) and
    // we only allow admins+ — matches the create/revoke check below. PAT
    // callers also need at minimum `read` scope.
    if (!canManageTokens(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requireScope(ctx, "read");
    const tokens = await listTokens(ctx);
    return NextResponse.json({ tokens });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    if (!canManageTokens(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requireScope(ctx, "admin");
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      scope?: string;
      expiresInDays?: number | null;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!SCOPES.includes(body.scope as TokenScope)) {
      return NextResponse.json({ error: "invalid scope" }, { status: 400 });
    }
    const expiresInDays =
      typeof body.expiresInDays === "number" && body.expiresInDays > 0
        ? body.expiresInDays
        : null;

    const result = await createToken(ctx, {
      name: body.name,
      scope: body.scope as TokenScope,
      expiresInDays,
    });
    // `display_token` is the ONLY time the plaintext is returned. The UI
    // surfaces it in a copy-once banner; subsequent GETs only return the
    // hint. The field name is snake_case so it stands out in client code as
    // a one-shot secret distinct from the regular DTO fields.
    return NextResponse.json(
      {
        token: {
          id: result.id,
          hint: result.hint,
          scope: result.scope,
          expiresAt: result.expiresAt,
        },
        display_token: result.token,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
