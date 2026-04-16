import { NextResponse, type NextRequest } from "next/server";
import {
  requireScope,
  requireTenantCtxAny,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { revokeToken } from "@/lib/db/tenant-api-tokens";

function canManageTokens(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function DELETE(
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
    const revoked = await revokeToken(ctx, id);
    if (!revoked) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ token: revoked });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
