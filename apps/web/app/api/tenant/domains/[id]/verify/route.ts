import { NextResponse, type NextRequest } from "next/server";
import {
  requireTenantCtx,
  TenantAccessError,
} from "@/lib/db/tenant-context";
import { verifyDomain } from "@/lib/custom-domains";

function canMutate(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireTenantCtx(req);
    if (!canMutate(ctx.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const result = await verifyDomain(ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TenantAccessError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
