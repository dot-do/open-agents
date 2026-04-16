import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { AdminAccessError, requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db/client";
import {
  memberships,
  sessions,
  tenantStripeCustomers,
  tenantUsageCounters,
  tenants,
} from "@/lib/db/schema";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function monthStart(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const ACTIVE_LIFECYCLE_STATES = [
  "provisioning",
  "active",
  "restoring",
] as const;

/**
 * GET /api/admin/tenants?limit=50&search=foo
 *
 * Cross-tenant tenant list with a lightweight usage summary per row.
 * Search matches tenant slug or name (case-insensitive). Capped at
 * MAX_LIMIT regardless of the requested limit. Read-only.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAdmin(req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get("limit");
  const search = url.searchParams.get("search")?.trim() ?? "";

  let limit = DEFAULT_LIMIT;
  if (rawLimit) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid limit" }, { status: 400 });
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }

  const where = search.length > 0
    ? or(
        ilike(tenants.slug, `%${search}%`),
        ilike(tenants.name, `%${search}%`),
      )
    : undefined;

  const tenantRows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(where)
    .orderBy(asc(tenants.slug))
    .limit(limit);

  if (tenantRows.length === 0) {
    return NextResponse.json({ tenants: [] });
  }

  const ids = tenantRows.map((t) => t.id);

  const [activeRows, monthlyRows, planRows, memberRows] = await Promise.all([
    db
      .select({
        tenantId: sessions.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.tenantId, ids),
          inArray(sessions.lifecycleState, [...ACTIVE_LIFECYCLE_STATES]),
        ),
      )
      .groupBy(sessions.tenantId),
    db
      .select({
        tenantId: tenantUsageCounters.tenantId,
        minutes: tenantUsageCounters.sandboxMinutes,
      })
      .from(tenantUsageCounters)
      .where(
        and(
          inArray(tenantUsageCounters.tenantId, ids),
          eq(tenantUsageCounters.periodStart, monthStart()),
        ),
      ),
    db
      .select({
        tenantId: tenantStripeCustomers.tenantId,
        plan: tenantStripeCustomers.plan,
        subscriptionStatus: tenantStripeCustomers.subscriptionStatus,
      })
      .from(tenantStripeCustomers)
      .where(inArray(tenantStripeCustomers.tenantId, ids)),
    db
      .select({
        tenantId: memberships.tenantId,
        count: sql<number>`count(*)::int`,
      })
      .from(memberships)
      .where(inArray(memberships.tenantId, ids))
      .groupBy(memberships.tenantId),
  ]);

  const activeByTenant = new Map<string, number>();
  for (const r of activeRows) {
    if (r.tenantId) activeByTenant.set(r.tenantId, r.count);
  }
  const minutesByTenant = new Map<string, number>();
  for (const r of monthlyRows) minutesByTenant.set(r.tenantId, r.minutes);
  const planByTenant = new Map<
    string,
    { plan: string; subscriptionStatus: string | null }
  >();
  for (const r of planRows) {
    planByTenant.set(r.tenantId, {
      plan: r.plan,
      subscriptionStatus: r.subscriptionStatus,
    });
  }
  const membersByTenant = new Map<string, number>();
  for (const r of memberRows) membersByTenant.set(r.tenantId, r.count);

  const result = tenantRows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    plan: planByTenant.get(t.id)?.plan ?? "free",
    subscriptionStatus:
      planByTenant.get(t.id)?.subscriptionStatus ?? null,
    activeSandboxes: activeByTenant.get(t.id) ?? 0,
    monthlyMinutes: minutesByTenant.get(t.id) ?? 0,
    memberCount: membersByTenant.get(t.id) ?? 0,
  }));

  // Sort: most active sandboxes first, then most monthly minutes — matches
  // what an on-call engineer scrolling for hot tenants wants to see.
  result.sort((a, b) => {
    if (a.activeSandboxes !== b.activeSandboxes) {
      return b.activeSandboxes - a.activeSandboxes;
    }
    return b.monthlyMinutes - a.monthlyMinutes;
  });

  return NextResponse.json({ tenants: result });
}
