import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantUsageCounters } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import {
  countActiveSandboxes,
  getCurrentDayCostCents,
  getCurrentMonthMinutes,
  getTenantQuotas,
} from "@/lib/quotas";

export interface UsageDayPoint {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  sandboxMinutes: number;
  costCents: number;
}

export interface TenantUsageSummary {
  tenantId: string;
  quotas: {
    maxConcurrentSandboxes: number;
    maxMonthlyMinutes: number;
    maxDailyCostCents: number;
  };
  current: {
    activeSandboxes: number;
    monthlyMinutes: number;
    dailyCostCents: number;
  };
  /** Oldest-first, last 30 days. May be sparse (only periods with rows). */
  last30Days: UsageDayPoint[];
}

function daysAgoUTC(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Assemble the per-tenant usage summary for the settings dashboard.
 *
 * Reads current-period counters + quota caps + a 30-day trailing window of
 * `tenant_usage_counters` rows. Caller must pass an already-resolved tenant
 * context (see `requireTenantCtx`).
 */
export async function getTenantUsageSummary(
  ctx: TenantContext,
): Promise<TenantUsageSummary> {
  const { tenantId } = ctx;
  const since = daysAgoUTC(30);

  const [quotas, monthlyMinutes, dailyCostCents, activeSandboxes, rows] =
    await Promise.all([
      getTenantQuotas(tenantId),
      getCurrentMonthMinutes(tenantId),
      getCurrentDayCostCents(tenantId),
      countActiveSandboxes(tenantId),
      db
        .select({
          date: tenantUsageCounters.periodStart,
          sandboxMinutes: tenantUsageCounters.sandboxMinutes,
          costCents: tenantUsageCounters.costCents,
        })
        .from(tenantUsageCounters)
        .where(
          and(
            eq(tenantUsageCounters.tenantId, tenantId),
            gte(tenantUsageCounters.periodStart, since),
          ),
        )
        .orderBy(desc(tenantUsageCounters.periodStart)),
    ]);

  const last30Days: UsageDayPoint[] = rows
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      sandboxMinutes: r.sandboxMinutes,
      costCents: r.costCents,
    }));

  return {
    tenantId,
    quotas: {
      maxConcurrentSandboxes: quotas.maxConcurrentSandboxes,
      maxMonthlyMinutes: quotas.maxMonthlyMinutes,
      maxDailyCostCents: quotas.maxDailyCostCents,
    },
    current: {
      activeSandboxes,
      monthlyMinutes,
      dailyCostCents,
    },
    last30Days,
  };
}
