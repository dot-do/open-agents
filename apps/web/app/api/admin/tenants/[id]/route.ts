import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db/client";
import { listMembershipsForTenant } from "@/lib/db/memberships";
import {
  auditEvents,
  sessions,
  tenantStripeCustomers,
  tenantUsageCounters,
  tenants,
} from "@/lib/db/schema";
import { getTenantQuotas } from "@/lib/quotas";

const RECENT_SESSIONS_LIMIT = 25;
const RECENT_AUDIT_LIMIT = 50;

function monthStart(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function dayStart(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * GET /api/admin/tenants/[id]
 *
 * Full tenant detail for the admin console. Members, recent sessions,
 * recent audit, current quotas + counters, and Stripe plan. Read-only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const { id } = await params;

  const [tenantRow] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      createdAt: tenants.createdAt,
      updatedAt: tenants.updatedAt,
    })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenantRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [members, sessionRows, auditRows, quotas, plan, counters] =
    await Promise.all([
      listMembershipsForTenant(id),
      db
        .select({
          id: sessions.id,
          title: sessions.title,
          status: sessions.status,
          lifecycleState: sessions.lifecycleState,
          repoOwner: sessions.repoOwner,
          repoName: sessions.repoName,
          branch: sessions.branch,
          lastActivityAt: sessions.lastActivityAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .where(eq(sessions.tenantId, id))
        .orderBy(desc(sessions.createdAt))
        .limit(RECENT_SESSIONS_LIMIT),
      db
        .select({
          id: auditEvents.id,
          actorUserId: auditEvents.actorUserId,
          action: auditEvents.action,
          target: auditEvents.target,
          metadata: auditEvents.metadata,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, id))
        .orderBy(desc(auditEvents.createdAt))
        .limit(RECENT_AUDIT_LIMIT),
      getTenantQuotas(id),
      db
        .select({
          plan: tenantStripeCustomers.plan,
          subscriptionStatus: tenantStripeCustomers.subscriptionStatus,
          currentPeriodEnd: tenantStripeCustomers.currentPeriodEnd,
        })
        .from(tenantStripeCustomers)
        .where(eq(tenantStripeCustomers.tenantId, id))
        .limit(1),
      db
        .select({
          periodStart: tenantUsageCounters.periodStart,
          sandboxMinutes: tenantUsageCounters.sandboxMinutes,
          costCents: tenantUsageCounters.costCents,
        })
        .from(tenantUsageCounters)
        .where(eq(tenantUsageCounters.tenantId, id))
        .orderBy(asc(tenantUsageCounters.periodStart)),
    ]);

  const monthlyMinutes =
    counters.find((c) => c.periodStart === monthStart())?.sandboxMinutes ?? 0;
  const dailyCostCents =
    counters.find((c) => c.periodStart === dayStart())?.costCents ?? 0;

  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, id),
        sql`${sessions.lifecycleState} IN ('provisioning', 'active', 'restoring')`,
      ),
    );

  return NextResponse.json({
    tenant: {
      id: tenantRow.id,
      slug: tenantRow.slug,
      name: tenantRow.name,
      createdAt: tenantRow.createdAt.toISOString(),
      updatedAt: tenantRow.updatedAt.toISOString(),
    },
    plan: {
      name: plan[0]?.plan ?? "free",
      subscriptionStatus: plan[0]?.subscriptionStatus ?? null,
      currentPeriodEnd: plan[0]?.currentPeriodEnd?.toISOString() ?? null,
    },
    quotas: {
      maxConcurrentSandboxes: quotas.maxConcurrentSandboxes,
      maxMonthlyMinutes: quotas.maxMonthlyMinutes,
      maxDailyCostCents: quotas.maxDailyCostCents,
      hardKillEnabled: quotas.hardKillEnabled,
      maxDailySpendByProvider: quotas.maxDailySpendByProvider ?? null,
    },
    usage: {
      activeSandboxes: activeRow?.count ?? 0,
      monthlyMinutes,
      dailyCostCents,
    },
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.email,
      username: m.username,
      name: m.name,
      avatarUrl: m.avatarUrl,
      createdAt: m.createdAt.toISOString(),
    })),
    recentSessions: sessionRows.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      lifecycleState: s.lifecycleState,
      repoOwner: s.repoOwner,
      repoName: s.repoName,
      branch: s.branch,
      lastActivityAt: s.lastActivityAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
    recentAudit: auditRows.map((a) => ({
      id: a.id,
      actorUserId: a.actorUserId,
      action: a.action,
      target: a.target,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}
