import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { withRateLimit } from "@/lib/rate-limit";
import { RbacError, requireRole } from "@/lib/rbac";
import { transferOwnership, TransferError } from "@/lib/tenant-transfer";

async function postHandler(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    requireRole(ctx, "owner");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const { newOwnerUserId } = body as { newOwnerUserId?: unknown };

    if (typeof newOwnerUserId !== "string" || !newOwnerUserId) {
      return NextResponse.json(
        { error: "newOwnerUserId is required" },
        { status: 400 },
      );
    }

    const result = await transferOwnership(ctx, newOwnerUserId);

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
