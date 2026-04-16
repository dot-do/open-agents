import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { audit, withTenantTags } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { buildSessionSetCookie } from "@/lib/session/cookie";
import { getSessionFromReq } from "@/lib/session/server";
import type { Session } from "@/lib/session/types";

/**
 * POST /api/admin/tenants/[id]/impersonate
 *
 * Re-issue the admin's session cookie scoped to `tenantId` with role
 * `viewer` and a sticky `impersonatedBy` field set to the original
 * admin's userId. The shell renders a banner whenever this field is
 * present so the operator never forgets they are not in their own
 * session.
 *
 * Safety:
 *  - role is forced to viewer (no writes via tenant-scoped routes that
 *    require member+ rank).
 *  - impersonatedBy is preserved across `requireTenantCtx` /
 *    `getServerSession` reads via the cookie -> server session passthrough.
 *  - audit row is written on the target tenant so the impersonated
 *    workspace's owners can see who jumped in.
 *  - clearing requires `/api/admin/stop-impersonating` which only runs if
 *    the caller is still in `ADMIN_USER_IDS`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let admin: { userId: string };
  try {
    admin = await requireAdmin(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const session = await getSessionFromReq(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Preserve the *original* admin id even when the caller is already in
  // an impersonation session. Lets the operator step from tenant A into
  // tenant B without losing the breadcrumb back to themselves.
  const originalAdmin = session.impersonatedBy ?? admin.userId;

  const next: Session = {
    ...session,
    activeTenantId: id,
    role: "viewer",
    impersonatedBy: originalAdmin,
  };

  const response = NextResponse.json({
    ok: true,
    activeTenantId: id,
    role: "viewer",
    impersonatedBy: originalAdmin,
  });
  response.headers.append("Set-Cookie", await buildSessionSetCookie(next));

  const ctx = { tenantId: id, userId: admin.userId };
  await withTenantTags(
    { ...ctx, role: "viewer" },
    "admin.impersonate",
    async () => {
      await audit(ctx, "admin.impersonate", {
        target: id,
        metadata: {
          tenantSlug: tenant.slug,
          adminUserId: originalAdmin,
        },
      });
    },
  );

  return response;
}
