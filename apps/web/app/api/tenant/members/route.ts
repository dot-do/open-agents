import { NextResponse, type NextRequest } from "next/server";
import { listMembershipsForTenant } from "@/lib/db/memberships";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { withReadRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole } from "@/lib/rbac";

async function getHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "admin");
    const members = await listMembershipsForTenant(ctx.tenantId);
    return NextResponse.json({ members });
  } catch (err) {
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export const GET = withReadRateLimit(getHandler);
