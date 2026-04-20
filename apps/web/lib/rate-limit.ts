/**
 * Per-tenant sliding-window rate limiter (wave 2A).
 *
 * Implementation notes:
 *   - Redis-backed sliding window using ZSET with timestamp scores. Each call
 *     ZADDs the current request, ZREMRANGEBYSCORE-trims older-than-window
 *     entries, and ZCARDs the remaining count. Grouped via a single pipeline
 *     keyed on the caller's rate-limit key.
 *   - Reuses the Node-side Redis client from `./redis.ts` (same `REDIS_URL` /
 *     `KV_URL` env pair used by `skills-cache.ts`). Avoids introducing a new
 *     client dependency.
 *   - **Fail-open**: any Redis error allows the request through (logged once
 *     per error class). A misbehaving Redis must never take the app down.
 *   - **No-Redis mode**: if neither env var is set we return `allowed=true`
 *     and warn once. Local dev / CI remain unaffected.
 *   - **Burst** is modeled as an additive allowance above the steady rpm:
 *     effective cap = rpm + burst. The window is always 60s; burst is a
 *     short-term cushion, not a separate bucket.
 *   - Node-only (ioredis). Callers must not import this from edge runtime
 *     code — use `withRateLimit` on individual API routes instead.
 */

import type Redis from "ioredis";
import { createRedisClient, isRedisConfigured } from "./redis";

export type RateLimitOptions = {
  rpm: number;
  burst: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Remaining requests in the current window (>= 0). */
  remaining: number;
  /** Milliseconds until the window slot frees up (>= 0). */
  resetMs: number;
  /** Effective cap (rpm + burst). Useful for headers. */
  limit: number;
};

const WINDOW_MS = 60_000;

let sharedClient: Redis | null | undefined;
let warnedNoRedis = false;
let warnedError = false;

function getClient(): Redis | null {
  if (sharedClient !== undefined) return sharedClient;
  if (!isRedisConfigured()) {
    sharedClient = null;
    return null;
  }
  try {
    sharedClient = createRedisClient("rate-limit");
  } catch (error) {
    console.error("[rate-limit] failed to init redis client:", error);
    sharedClient = null;
  }
  return sharedClient;
}

/**
 * Sliding-window rate limit check. See file header for the algorithm.
 *
 * Returns `{ allowed, remaining, resetMs, limit }`. Fail-open: any internal
 * error returns `allowed=true` with best-effort values.
 */
export async function rateLimit(
  key: string,
  { rpm, burst }: RateLimitOptions,
): Promise<RateLimitResult> {
  const limit = Math.max(1, rpm + burst);
  const client = getClient();

  if (!client) {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      console.warn(
        "[rate-limit] Redis not configured — rate limiting disabled (allow-all).",
      );
    }
    return { allowed: true, remaining: limit, resetMs: 0, limit };
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.zrange(key, 0, 0, "WITHSCORES");
    pipeline.pexpire(key, WINDOW_MS * 2);
    const results = await pipeline.exec();

    if (!results) {
      return { allowed: true, remaining: limit, resetMs: 0, limit };
    }

    const countRaw = results[2]?.[1];
    const oldestRaw = results[3]?.[1] as string[] | undefined;
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw ?? 0);

    let resetMs = 0;
    if (oldestRaw && oldestRaw.length >= 2) {
      const oldestScore = Number(oldestRaw[1]);
      if (!Number.isNaN(oldestScore)) {
        resetMs = Math.max(0, oldestScore + WINDOW_MS - now);
      }
    }

    if (count > limit) {
      // Evict the member we just added so the zset reflects reality.
      await client.zrem(key, member).catch(() => undefined);
      return {
        allowed: false,
        remaining: 0,
        resetMs: resetMs || WINDOW_MS,
        limit,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      resetMs,
      limit,
    };
  } catch (error) {
    if (!warnedError) {
      warnedError = true;
      console.error("[rate-limit] redis error — failing open:", error);
    }
    return { allowed: true, remaining: limit, resetMs: 0, limit };
  }
}

/** Test hook: reset memoized client so tests can re-init. */
export function __resetRateLimitClientForTests(): void {
  sharedClient = undefined;
  warnedNoRedis = false;
  warnedError = false;
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPlan, getRateLimitForPlan } from "./billing";
import { requireTenantCtx } from "./db/tenant-context";
import { addRateLimitHeaders } from "./rate-limit-headers";

/**
 * Wrap a route handler with per-tenant rate limiting. Applies plan-scoped
 * caps from PLAN_MATRIX. On breach returns 429 with Retry-After and
 * X-RateLimit-* headers. Fail-open on Redis errors.
 */
export function withRateLimit<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<Response> | Response,
  opts?: { category?: string },
): (req: NextRequest, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    let ctx;
    try {
      ctx = await requireTenantCtx(req);
    } catch {
      return handler(req, ...args) as Promise<Response>;
    }
    const plan = await getPlan(ctx).catch(() => "free" as const);
    const cfg = getRateLimitForPlan(plan);
    const key = `rl:tenant:${ctx.tenantId}:${opts?.category ?? "write"}`;
    const result = await rateLimit(key, cfg);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "rate_limited" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": String(Math.ceil(result.resetMs / 1000) || 1),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Date.now() + result.resetMs),
          },
        },
      );
    }
    const response = (await handler(req, ...args)) as Response;
    return addRateLimitHeaders(response, result);
  };
}

/**
 * Lighter rate-limit wrapper for read (GET) routes. Uses 5x the plan's
 * write cap to allow more headroom for reads while still preventing abuse.
 * Adds X-RateLimit-* headers to every response.
 */
export function withReadRateLimit<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<Response> | Response,
): (req: NextRequest, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    let ctx;
    try {
      ctx = await requireTenantCtx(req);
    } catch {
      return handler(req, ...args) as Promise<Response>;
    }
    const plan = await getPlan(ctx).catch(() => "free" as const);
    const baseCfg = getRateLimitForPlan(plan);
    const readCfg = { rpm: baseCfg.rpm * 5, burst: baseCfg.burst * 5 };
    const key = `rl:tenant:${ctx.tenantId}:read`;
    const result = await rateLimit(key, readCfg);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "rate_limited" }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "Retry-After": String(Math.ceil(result.resetMs / 1000) || 1),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(Date.now() + result.resetMs),
          },
        },
      );
    }
    const response = (await handler(req, ...args)) as Response;
    return addRateLimitHeaders(response, result);
  };
}
