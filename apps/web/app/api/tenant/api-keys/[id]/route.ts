import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { revokeKey } from "@/lib/db/tenant-api-keys";
import { withRateLimit } from "@/lib/rate-limit";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const revoked = await revokeKey(ctx, id);
    if (!revoked) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ key: revoked });
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const DELETE = withRateLimit(deleteHandler, { category: "keys:write" });
