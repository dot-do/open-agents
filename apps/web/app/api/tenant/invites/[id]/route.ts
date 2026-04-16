import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { revokeInvite } from "@/lib/invites";
import { RbacError, requireRole } from "@/lib/rbac";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    const { id } = await params;
    await revokeInvite(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
