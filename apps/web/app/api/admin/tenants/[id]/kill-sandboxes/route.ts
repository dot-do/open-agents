import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { audit, withTenantTags } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { killTenantSandboxes } from "@/lib/quotas";

/**
 * POST /api/admin/tenants/[id]/kill-sandboxes
 *
 * Force-terminate every live sandbox for a tenant. Calls the same
 * `killTenantSandboxes` helper used by the quota sweeper, then writes an
 * `admin.kill` audit row on the affected tenant with the admin user as
 * actor.
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

  const { id } = await params;

  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const reason = `admin_kill:${admin.userId}`;

  const ctx = { tenantId: id, userId: admin.userId };
  const results = await withTenantTags(
    { ...ctx, role: null },
    "admin.kill",
    async () => {
      const r = await killTenantSandboxes(id, reason);
      // Write the cross-tenant admin audit row on the affected tenant. The
      // actor is the admin's user id so audit log readers can trace which
      // operator triggered the kill.
      await audit(ctx, "admin.kill", {
        target: id,
        metadata: {
          reason,
          attempted: r.length,
          stopped: r.filter((x) => x.stopped).length,
          tenantSlug: tenant.slug,
        },
      });
      return r;
    },
  );

  return NextResponse.json({
    ok: true,
    tenantId: id,
    results,
  });
}
