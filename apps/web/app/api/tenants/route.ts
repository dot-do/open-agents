import { NextResponse, type NextRequest } from "next/server";
import { listMembershipsForUser } from "@/lib/db/memberships";
import { getSessionFromReq } from "@/lib/session/server";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const memberships = await listMembershipsForUser(userId);
  return NextResponse.json({
    activeTenantId: session?.activeTenantId ?? memberships[0]?.tenantId ?? null,
    memberships,
  });
}
