import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { db } from "@/lib/db/client";
import {
  sessions,
  tenantQuotas,
  tenantUsageCounters,
  type TenantQuota,
} from "@/lib/db/schema";
import { updateSession } from "@/lib/db/sessions";
import {
  canOperateOnSandbox,
  clearSandboxState,
} from "@/lib/sandbox/utils";

/**
 * Thrown when a tenant action would exceed a configured quota. API routes
 * should surface these as HTTP 429 responses.
 */
export class QuotaExceededError extends Error {
  readonly quota:
    | "concurrent_sandboxes"
    | "monthly_minutes"
    | "daily_cost_cents";
  readonly limit: number;
  readonly current: number;
  constructor(
    quota:
      | "concurrent_sandboxes"
      | "monthly_minutes"
      | "daily_cost_cents",
    limit: number,
    current: number,
  ) {
    super(`Quota exceeded: ${quota} (current=${current}, limit=${limit})`);
    this.name = "QuotaExceededError";
    this.quota = quota;
    this.limit = limit;
    this.current = current;
  }
}

const DEFAULT_QUOTAS: Omit<TenantQuota, "tenantId" | "updatedAt"> = {
  maxConcurrentSandboxes: 3,
  maxMonthlyMinutes: 600,
  maxDailyCostCents: 500,
  hardKillEnabled: true,
};

/**
 * Fetch the quota row for a tenant, returning defaults when absent.
 * Defaults intentionally apply on first read — no backfill required.
 */
export async function getTenantQuotas(
  tenantId: string,
): Promise<Omit<TenantQuota, "updatedAt"> & { tenantId: string }> {
  const [row] = await db
    .select()
    .from(tenantQuotas)
    .where(eq(tenantQuotas.tenantId, tenantId))
    .limit(1);
  if (row) return row;
  return { tenantId, ...DEFAULT_QUOTAS };
}

const ACTIVE_LIFECYCLE_STATES = [
  "provisioning",
  "active",
  "restoring",
] as const;

/**
 * Count live sandboxes attributed to a tenant. Sessions are the source of
 * truth because they hold the durable sandbox state handle; a session in
 * `provisioning`/`active`/`restoring` maps to a live Vercel sandbox.
 */
export async function countActiveSandboxes(
  tenantId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        inArray(sessions.lifecycleState, [...ACTIVE_LIFECYCLE_STATES]),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Throw {@link QuotaExceededError} when the tenant already has at least
 * `maxConcurrentSandboxes` live sandboxes. Call before any sandbox spawn.
 */
export async function checkConcurrencyQuota(tenantId: string): Promise<void> {
  const [quotas, current] = await Promise.all([
    getTenantQuotas(tenantId),
    countActiveSandboxes(tenantId),
  ]);
  if (current >= quotas.maxConcurrentSandboxes) {
    throw new QuotaExceededError(
      "concurrent_sandboxes",
      quotas.maxConcurrentSandboxes,
      current,
    );
  }
}

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
 * Read the current month's sandbox minutes for a tenant, or 0 if no row.
 */
export async function getCurrentMonthMinutes(
  tenantId: string,
): Promise<number> {
  const period = monthStart();
  const [row] = await db
    .select({ minutes: tenantUsageCounters.sandboxMinutes })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, tenantId),
        eq(tenantUsageCounters.periodStart, period),
      ),
    )
    .limit(1);
  return row?.minutes ?? 0;
}

/**
 * Read today's cost (cents) for a tenant, or 0 if no row.
 */
export async function getCurrentDayCostCents(
  tenantId: string,
): Promise<number> {
  const period = dayStart();
  const [row] = await db
    .select({ cents: tenantUsageCounters.costCents })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.tenantId, tenantId),
        eq(tenantUsageCounters.periodStart, period),
      ),
    )
    .limit(1);
  return row?.cents ?? 0;
}

/**
 * Throw when the tenant is at or over its monthly minutes quota.
 */
export async function checkMinuteQuota(tenantId: string): Promise<void> {
  const [quotas, used] = await Promise.all([
    getTenantQuotas(tenantId),
    getCurrentMonthMinutes(tenantId),
  ]);
  if (used >= quotas.maxMonthlyMinutes) {
    throw new QuotaExceededError(
      "monthly_minutes",
      quotas.maxMonthlyMinutes,
      used,
    );
  }
}

/**
 * Atomically add sandbox minutes to the current month's counter row.
 * Uses INSERT ... ON CONFLICT DO UPDATE so concurrent workers serialize
 * safely without a read-modify-write race.
 */
export async function recordSandboxMinutes(
  tenantId: string,
  minutes: number,
): Promise<void> {
  if (minutes <= 0) return;
  const period = monthStart();
  await db
    .insert(tenantUsageCounters)
    .values({
      tenantId,
      periodStart: period,
      sandboxMinutes: minutes,
      costCents: 0,
    })
    .onConflictDoUpdate({
      target: [tenantUsageCounters.tenantId, tenantUsageCounters.periodStart],
      set: {
        sandboxMinutes: sql`${tenantUsageCounters.sandboxMinutes} + ${minutes}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Atomically add cost (in cents) to today's counter row.
 */
export async function recordSandboxCost(
  tenantId: string,
  cents: number,
): Promise<void> {
  if (cents <= 0) return;
  const period = dayStart();
  await db
    .insert(tenantUsageCounters)
    .values({
      tenantId,
      periodStart: period,
      sandboxMinutes: 0,
      costCents: cents,
    })
    .onConflictDoUpdate({
      target: [tenantUsageCounters.tenantId, tenantUsageCounters.periodStart],
      set: {
        costCents: sql`${tenantUsageCounters.costCents} + ${cents}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Result detail for a single sandbox termination attempt in {@link killTenantSandboxes}.
 */
export interface KillResult {
  sessionId: string;
  stopped: boolean;
  error?: string;
}

/**
 * Terminate all live sandboxes for a tenant. Iterates the tenant's
 * sessions in an active lifecycle state, connects via the persistent
 * sandbox handle, and calls `sandbox.stop()` — the same teardown path
 * used by the DELETE /api/sandbox route.
 *
 * `reason` is recorded in the structured log line emitted per kill so
 * on-call can trace back which policy triggered the termination.
 */
export async function killTenantSandboxes(
  tenantId: string,
  reason: string,
): Promise<KillResult[]> {
  const rows = await db
    .select({
      id: sessions.id,
      sandboxState: sessions.sandboxState,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        inArray(sessions.lifecycleState, [...ACTIVE_LIFECYCLE_STATES]),
      ),
    );

  const results: KillResult[] = [];
  for (const row of rows) {
    const state = row.sandboxState as SandboxState | null;
    if (!state || !canOperateOnSandbox(state)) {
      results.push({ sessionId: row.id, stopped: false, error: "not-operable" });
      continue;
    }
    try {
      const sandbox = await connectSandbox(state);
      await sandbox.stop();
      await updateSession(row.id, {
        sandboxState: clearSandboxState(state),
        lifecycleState: "hibernated",
        lifecycleError: `killed: ${reason}`,
        sandboxExpiresAt: null,
        hibernateAfter: null,
      });
      console.log(
        JSON.stringify({
          event: "tenant.sandbox.killed",
          tenantId,
          sessionId: row.id,
          reason,
        }),
      );
      results.push({ sessionId: row.id, stopped: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          event: "tenant.sandbox.kill_failed",
          tenantId,
          sessionId: row.id,
          reason,
          error: message,
        }),
      );
      results.push({ sessionId: row.id, stopped: false, error: message });
    }
  }
  return results;
}

export interface QuotaSweepReport {
  tenantId: string;
  action: "ok" | "minutes_over" | "cost_warning" | "cost_halted";
  detail?: Record<string, unknown>;
}

/**
 * One-shot sweep: inspects every tenant with a usage counter row this
 * period, emits structured logs for over-quota tenants, and — when
 * `hardKillEnabled` is true — terminates the tenant's live sandboxes.
 *
 * Intended to be invoked from a cron (see `app/api/cron/tenant-quotas`
 * and the ops runbook in the task report).
 */
export async function sweepTenantQuotas(): Promise<QuotaSweepReport[]> {
  const today = dayStart();
  const month = monthStart();
  // Pull any tenant with activity this month or today — the universe of
  // tenants to evaluate. Quiet tenants need no action.
  const active = await db
    .select({
      tenantId: tenantUsageCounters.tenantId,
      periodStart: tenantUsageCounters.periodStart,
      sandboxMinutes: tenantUsageCounters.sandboxMinutes,
      costCents: tenantUsageCounters.costCents,
    })
    .from(tenantUsageCounters)
    .where(
      inArray(tenantUsageCounters.periodStart, [today, month]),
    );

  const byTenant = new Map<
    string,
    { minutes: number; cents: number }
  >();
  for (const row of active) {
    const cur = byTenant.get(row.tenantId) ?? { minutes: 0, cents: 0 };
    if (row.periodStart === month) cur.minutes = row.sandboxMinutes;
    if (row.periodStart === today) cur.cents = row.costCents;
    byTenant.set(row.tenantId, cur);
  }

  const reports: QuotaSweepReport[] = [];
  for (const [tenantId, counters] of byTenant) {
    const quotas = await getTenantQuotas(tenantId);
    const minutesOver =
      counters.minutes >= quotas.maxMonthlyMinutes;
    const costPct =
      quotas.maxDailyCostCents > 0
        ? counters.cents / quotas.maxDailyCostCents
        : 0;

    if (minutesOver) {
      console.warn(
        JSON.stringify({
          event: "tenant.minutes.halted",
          tenantId,
          used: counters.minutes,
          limit: quotas.maxMonthlyMinutes,
        }),
      );
      if (quotas.hardKillEnabled) {
        await killTenantSandboxes(tenantId, "monthly_minutes_exhausted");
      }
      reports.push({
        tenantId,
        action: "minutes_over",
        detail: {
          used: counters.minutes,
          limit: quotas.maxMonthlyMinutes,
          killed: quotas.hardKillEnabled,
        },
      });
      continue;
    }

    if (costPct >= 1) {
      console.warn(
        JSON.stringify({
          event: "tenant.cost.halted",
          tenantId,
          used: counters.cents,
          limit: quotas.maxDailyCostCents,
        }),
      );
      if (quotas.hardKillEnabled) {
        await killTenantSandboxes(tenantId, "daily_cost_exhausted");
      }
      reports.push({
        tenantId,
        action: "cost_halted",
        detail: {
          used: counters.cents,
          limit: quotas.maxDailyCostCents,
          killed: quotas.hardKillEnabled,
        },
      });
      continue;
    }

    if (costPct >= 0.8) {
      console.warn(
        JSON.stringify({
          event: "tenant.cost.warning",
          tenantId,
          used: counters.cents,
          limit: quotas.maxDailyCostCents,
          pct: Math.round(costPct * 100),
        }),
      );
      reports.push({
        tenantId,
        action: "cost_warning",
        detail: {
          used: counters.cents,
          limit: quotas.maxDailyCostCents,
          pct: Math.round(costPct * 100),
        },
      });
      continue;
    }

    reports.push({ tenantId, action: "ok" });
  }

  return reports;
}
