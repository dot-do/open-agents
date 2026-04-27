import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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
import { validateBody } from "@/lib/validation";

const SCOPES: TokenScope[] = ["read", "write", "admin"];

const createTokenSchema = z.object({
  name: z.string().min(1, "name is required").max(100).transform((s) => s.trim()),
  scope: z.enum(["read", "write", "admin"]),
  expiresInDays: z.number().int().positive().nullable().optional(),
});

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
    const { data: body, response } = await validateBody(req, createTokenSchema);
    if (response) return response;

    const result = await createToken(ctx, {
      name: body.name,
      scope: body.scope as TokenScope,
      expiresInDays: body.expiresInDays ?? null,
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
