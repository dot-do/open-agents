import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { auditEvents, users } from "@/lib/db/schema";
import { lookupTenantBySlug } from "@/lib/db/tenants";
import { ActivityFeedClient } from "./activity-feed-client";

export const dynamic = "force-dynamic";

/**
 * Tenant activity feed page. Shows the 50 most recent audit events. The
 * client wrapper handles auto-refresh via polling.
 */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await lookupTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorUserId: auditEvents.actorUserId,
      target: auditEvents.target,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      actorName: users.name,
      actorUsername: users.username,
      actorAvatarUrl: users.avatarUrl,
    })
    .from(auditEvents)
    .leftJoin(users, eq(auditEvents.actorUserId, users.id))
    .where(eq(auditEvents.tenantId, tenant.id))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Recent events in {tenant.name}
        </p>
      </header>
      <ActivityFeedClient
        tenantSlug={tenantSlug}
        initialEvents={rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
