import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantStripeCustomers, tenantUsageCounters } from "@/lib/db/schema";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { getPlan, PLAN_MATRIX } from "@/lib/billing";

/**
 * GET /api/billing/summary — current plan + current-period usage counters
 * for the billing settings page.
 */
export async function GET(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const plan = await getPlan({ tenantId: ctx.tenantId });
  const now = new Date();
  const monthPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const dayPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const [monthRow] = await db
    .select({
      minutes: tenantUsageCounters.sandboxMinutes,
      costCents: tenantUsageCounters.costCents,
    })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, ctx.tenantId),
        eq(tenantUsageCounters.periodStart, monthPeriod),
      ),
    )
    .limit(1);

  const [dayRow] = await db
    .select({ costCents: tenantUsageCounters.costCents })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, ctx.tenantId),
        eq(tenantUsageCounters.periodStart, dayPeriod),
      ),
    )
    .limit(1);

  const [stripeRow] = await db
    .select({
      subscriptionStatus: tenantStripeCustomers.subscriptionStatus,
      currentPeriodEnd: tenantStripeCustomers.currentPeriodEnd,
    })
    .from(tenantStripeCustomers)
    .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
    .limit(1);

  return NextResponse.json({
    plan,
    planMatrix: PLAN_MATRIX[plan],
    subscriptionStatus: stripeRow?.subscriptionStatus ?? null,
    currentPeriodEnd: stripeRow?.currentPeriodEnd ?? null,
    usage: {
      monthSandboxMinutes: monthRow?.minutes ?? 0,
      monthCostCents: monthRow?.costCents ?? 0,
      dayCostCents: dayRow?.costCents ?? 0,
    },
  });
}
