import "server-only";

import type Redis from "ioredis";
import {
  createRedisClient,
  isRedisConfigured,
  warnRedisDisabled,
} from "@/lib/redis";
import { getTenantQuotas, QuotaExceededError } from "@/lib/quotas";

/**
 * Per-provider daily spend caps (Wave 6 / open-agents-lcc).
 *
 * Why Redis instead of Postgres?
 *   - The existing `tenant_usage_counters` table is keyed on
 *     (tenant_id, period_start) and has no provider dimension. Adding one
 *     would require a schema migration (a new column or new table), and
 *     this wave explicitly forbids schema changes.
 *   - The hot path here is "after every chat completion, increment a
 *     counter and check it against a cap". Redis INCRBY on a per-day
 *     key is atomic, sub-millisecond, and survives the request without
 *     adding write pressure to Postgres.
 *   - The trade-off is durability: if Redis loses data we lose visibility
 *     into a tenant's daily provider spend. That's acceptable here
 *     because (a) the global `maxDailyCostCents` quota — backed by
 *     Postgres — still applies, (b) Stripe metering events still flow
 *     through, and (c) the worst case is "tenant gets one extra day of
 *     headroom on per-provider caps", not lost billing.
 *
 * Key shape: `tenant:{tenantId}:provider-spend:{provider}:{YYYY-MM-DD}`
 * TTL: 48h, so yesterday's row is retained briefly for any straggling
 * post-finish increments to land before expiring.
 */

const KEY_PREFIX = "tenant";
const KEY_NAMESPACE = "provider-spend";
const KEY_TTL_SECONDS = 48 * 60 * 60;
const FEATURE_NAME = "provider-spend-counters";

let sharedClient: Redis | null | undefined;

function getClient(): Redis | null {
  if (sharedClient !== undefined) return sharedClient;
  if (!isRedisConfigured()) {
    warnRedisDisabled(FEATURE_NAME);
    sharedClient = null;
    return sharedClient;
  }
  sharedClient = createRedisClient(FEATURE_NAME);
  return sharedClient;
}

/**
 * Test seam — lets the unit tests inject an in-memory client without
 * touching `process.env`. Not used in production code paths.
 */
export function __setProviderSpendRedisClientForTests(
  client: Redis | null,
): void {
  sharedClient = client;
}

function dayBucket(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function keyFor(tenantId: string, provider: string, day: string): string {
  return `${KEY_PREFIX}:${tenantId}:${KEY_NAMESPACE}:${provider}:${day}`;
}

/**
 * Atomically add `costCents` to the day's per-provider counter. No-op
 * when costCents <= 0 or when Redis is unavailable (caller should not
 * rely on this for invoicing — Stripe metering is the system of record).
 */
export async function recordProviderSpend(
  tenantId: string,
  provider: string,
  costCents: number,
): Promise<void> {
  if (!tenantId || !provider) return;
  if (!Number.isFinite(costCents) || costCents <= 0) return;
  const client = getClient();
  if (!client) return;
  const day = dayBucket();
  const key = keyFor(tenantId, provider, day);
  try {
    // Pipeline INCRBY + EXPIRE so the TTL is set on first write without
    // an extra round-trip and without races where a key persists forever.
    const pipeline = client.pipeline();
    pipeline.incrby(key, Math.round(costCents));
    pipeline.expire(key, KEY_TTL_SECONDS);
    await pipeline.exec();
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "tenant.provider_spend.record_failed",
        tenantId,
        provider,
        costCents,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Read today's per-provider spend in cents. Returns 0 when no row exists
 * or when Redis is unavailable.
 */
export async function getProviderSpendToday(
  tenantId: string,
  provider: string,
): Promise<number> {
  if (!tenantId || !provider) return 0;
  const client = getClient();
  if (!client) return 0;
  const day = dayBucket();
  const key = keyFor(tenantId, provider, day);
  try {
    const raw = await client.get(key);
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "tenant.provider_spend.read_failed",
        tenantId,
        provider,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 0;
  }
}

/**
 * Throw {@link QuotaExceededError} when adding `additionalCents` would
 * push the tenant over its configured per-provider daily cap. No-op when
 * no cap is set for the provider (or no caps at all are configured).
 *
 * Surfaces as `quota: 'daily_cost_cents'` because the existing error
 * shape only has three quota tags and the API contract documents this
 * as a daily cost cap; route handlers should also surface the provider
 * name in the response body when re-throwing.
 */
export async function assertProviderSpendUnderCap(
  tenantId: string,
  provider: string,
  additionalCents = 0,
): Promise<void> {
  if (!tenantId || !provider) return;
  const quotas = await getTenantQuotas(tenantId);
  const caps = quotas.maxDailySpendByProvider;
  if (!caps) return;
  const cap = caps[provider];
  if (typeof cap !== "number" || cap <= 0) return;

  const current = await getProviderSpendToday(tenantId, provider);
  const projected = current + Math.max(0, additionalCents);
  if (projected >= cap) {
    throw new QuotaExceededError(
      "daily_cost_cents",
      cap,
      projected,
    );
  }
}
