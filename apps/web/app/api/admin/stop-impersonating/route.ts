import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import { getSessionFromReq } from "@/lib/session/server";
import type { Session, SessionRole } from "@/lib/session/types";

/**
 * POST /api/admin/stop-impersonating
 *
 * Re-issue the session cookie for the *original* admin user (the value
 * stashed in `impersonatedBy`). Clears `impersonatedBy` and rebinds
 * `activeTenantId` + `role` to the admin's first membership. Refuses if
 * the original admin is no longer in `ADMIN_USER_IDS` so a revoked
 * admin can't re-acquire their original session via this path.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const session = await getSessionFromReq(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const adminUserId = session.impersonatedBy;
  if (!adminUserId) {
    return NextResponse.json(
      { error: "not_impersonating" },
      { status: 400 },
    );
  }
  if (!isAdmin(adminUserId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Re-bind the session to the admin's first (oldest) membership so the
  // user lands somewhere coherent. If they have no memberships left we
  // drop the active tenant — `requireTenantCtx` will fall back at next
  // request.
  const [primary] = await db
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
    })
    .from(memberships)
    .where(eq(memberships.userId, adminUserId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);

  const next: Session = {
    ...session,
    user: { ...session.user, id: adminUserId },
    activeTenantId: primary?.tenantId,
    role: (primary?.role as SessionRole | undefined) ?? undefined,
    impersonatedBy: undefined,
  };

  const response = NextResponse.json({
    ok: true,
    activeTenantId: next.activeTenantId ?? null,
    role: next.role ?? null,
  });
  response.headers.append("Set-Cookie", await buildSessionSetCookie(next));
  return response;
}
