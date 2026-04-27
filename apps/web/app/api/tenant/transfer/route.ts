import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { withRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole } from "@/lib/rbac";
import { transferOwnership, TransferError } from "@/lib/tenant-transfer";
import { validateBody } from "@/lib/validation";

const transferSchema = z.object({
  newOwnerUserId: z.string().min(1, "newOwnerUserId is required").max(100),
});

async function postHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "owner");

    const { data, response } = await validateBody(req, transferSchema);
    if (response) return response;

    const result = await transferOwnership(ctx, data.newOwnerUserId);

    return NextResponse.json({
      ok: true,
      previousOwner: result.previousOwner,
      newOwner: result.newOwner,
    });
  } catch (err) {
    if (err instanceof TransferError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof RbacError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

export const POST = withRateLimit(postHandler, {
  category: "transfer:write",
});
