import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { listMembershipsForUser } from "@/lib/db/memberships";
import { lookupTenantBySlug } from "@/lib/db/tenants";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * Guard for `/t/[tenantSlug]/…` routes. Verifies the slug resolves to a
 * tenant the current user belongs to; on mismatch, redirects to the user's
 * active tenant slug (or `/` when they have none). The session's active
 * tenant is NOT updated here — switching is user-intent and flows through
 * `/api/tenants/switch`.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/");
  }

  const [tenant, memberships] = await Promise.all([
    lookupTenantBySlug(tenantSlug),
    listMembershipsForUser(session.user.id),
  ]);

  if (!tenant) {
    redirect("/");
  }

  const membership = memberships.find((m) => m.tenantId === tenant.id);
  if (!membership) {
    // Not a member — bounce to the active tenant if we have one, else home.
    const active =
      memberships.find((m) => m.tenantId === session.activeTenantId) ??
      memberships[0];
    redirect(active ? `/t/${active.tenantSlug}` : "/");
  }

  return <>{children}</>;
}
