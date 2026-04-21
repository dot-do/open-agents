import { NextResponse, type NextRequest } from "next/server";
import {
  requireScope,
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { rotateToken } from "@/lib/db/tenant-api-tokens";

function canManageTokens(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtxAny(req);
    if (!canManageTokens(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    requireScope(ctx, "admin");
    const { id } = await params;
    const result = await rotateToken(ctx, id);
    if (!result) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      token: {
        id: result.id,
        hint: result.hint,
        scope: result.scope,
        expiresAt: result.expiresAt,
      },
      display_token: result.token,
    });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
