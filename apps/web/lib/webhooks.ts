import "server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  tenantWebhookDeliveries,
  tenantWebhooks,
  type TenantWebhook,
  type TenantWebhookDelivery,
} from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import { decrypt, encrypt } from "@/lib/crypto";
import { scopedQuery } from "@/lib/db/tenant-guard";

/**
 * Outbound tenant webhook subscriptions (issue open-agents-uom).
 *
 * Crypto: `secret` is sealed with v2 GCM via `apps/web/lib/crypto.ts#encrypt`,
 * AAD bound to `tenant:{tenantId}`. The plaintext is returned exactly once
 * from `createWebhook` — never persisted in the response or list endpoint.
 *
 * Retry policy: per-attempt delays in `BACKOFF_SCHEDULE_MS`. After
 * `MAX_ATTEMPTS` failures the row is marked `dead` and stays out of the
 * dispatcher's polling window.
 */

const MAX_ATTEMPTS = 5;
// 1m, 5m, 30m, 2h, 12h — applied for the *next* attempt after a failure.
// Index 0 is used after attempt 1 fails, etc. The 5th failure → dead.
const BACKOFF_SCHEDULE_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
];

const DELIVERY_TIMEOUT_MS = 10_000;

export type WebhookDTO = {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: number | null;
};

export type CreateWebhookInput = {
  url: string;
  events: string[];
  secret?: string;
};

export type UpdateWebhookInput = Partial<{
  url: string;
  events: string[];
  enabled: boolean;
}>;

export type DeliveryDTO = {
  id: string;
  webhookId: string;
  event: string;
  status: TenantWebhookDelivery["status"];
  attempts: number;
  responseStatus: number | null;
  createdAt: Date;
  completedAt: Date | null;
  nextAttemptAt: Date | null;
};

export type DispatchResult = {
  picked: number;
  succeeded: number;
  failed: number;
  dead: number;
};

function aadFor(tenantId: string): string {
  return `tenant:${tenantId}`;
}

function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function toDTO(row: TenantWebhook): WebhookDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    url: row.url,
    events: row.events,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryStatus: row.lastDeliveryStatus,
  };
}

function toDeliveryDTO(row: TenantWebhookDelivery): DeliveryDTO {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    nextAttemptAt: row.nextAttemptAt,
  };
}

export async function createWebhook(
  ctx: TenantContext,
  input: CreateWebhookInput,
): Promise<{ webhook: WebhookDTO; secret: string }> {
  const url = input.url.trim();
  if (!isValidUrl(url)) {
    throw new Error("invalid url");
  }
  const events = (input.events ?? [])
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (events.length === 0) {
    throw new Error("events required");
  }
  const secretPlain = (input.secret?.trim() || generateSecret());
  if (secretPlain.length < 16) {
    throw new Error("secret too short");
  }
  const secretCipher = encrypt(secretPlain, aadFor(ctx.tenantId));

  const id = randomUUID();
  const sq = scopedQuery(ctx);
  const inserted = (await (
    sq.insertInto(tenantWebhooks, {
      id,
      url,
      secret: secretCipher,
      events,
      enabled: true,
    }) as unknown as {
      returning: () => Promise<TenantWebhook[]>;
    }
  ).returning()) as TenantWebhook[];

  const row = inserted[0];
  if (!row) throw new Error("failed to insert webhook");
  return { webhook: toDTO(row), secret: secretPlain };
}

export async function listWebhooks(
  ctx: Pick<TenantContext, "tenantId">,
): Promise<WebhookDTO[]> {
  const rows = (await db
    .select()
    .from(tenantWebhooks)
    .where(eq(tenantWebhooks.tenantId, ctx.tenantId))
    .orderBy(desc(tenantWebhooks.createdAt))) as TenantWebhook[];
  return rows.map(toDTO);
}

export async function updateWebhook(
  ctx: TenantContext,
  id: string,
  partial: UpdateWebhookInput,
): Promise<WebhookDTO | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (partial.url !== undefined) {
    if (!isValidUrl(partial.url)) throw new Error("invalid url");
    set.url = partial.url.trim();
  }
  if (partial.events !== undefined) {
    const events = partial.events
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    if (events.length === 0) throw new Error("events required");
    set.events = events;
  }
  if (partial.enabled !== undefined) {
    set.enabled = !!partial.enabled;
  }
  const rows = (await db
    .update(tenantWebhooks)
    .set(set)
    .where(
      and(
        eq(tenantWebhooks.id, id),
        eq(tenantWebhooks.tenantId, ctx.tenantId),
      ),
    )
    .returning()) as TenantWebhook[];
  const row = rows[0];
  return row ? toDTO(row) : null;
}

export async function deleteWebhook(
  ctx: TenantContext,
  id: string,
): Promise<boolean> {
  const rows = (await db
    .delete(tenantWebhooks)
    .where(
      and(
        eq(tenantWebhooks.id, id),
        eq(tenantWebhooks.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: tenantWebhooks.id })) as { id: string }[];
  return rows.length > 0;
}

/**
 * Enqueue a delivery row (status=pending, nextAttemptAt=now) for every
 * enabled tenant webhook subscribed to `event`. Caller MUST wrap this in a
 * try/catch — the parent flow (session spawn, billing change, etc.) must
 * never break because of a webhook outage.
 */
export async function enqueueEvent(
  tenantId: string,
  event: string,
  payload: unknown,
): Promise<number> {
  const sq = scopedQuery({ tenantId });
  const subs = (await sq.selectFrom(
    tenantWebhooks,
    eq(tenantWebhooks.enabled, true),
  )) as TenantWebhook[];

  // Filter in-memory so we don't have to hand-craft a Postgres `events @> ARRAY[...]`
  // SQL fragment via Drizzle. Subscription counts per tenant are tiny.
  const matching = subs.filter((s) => s.events.includes(event));
  if (matching.length === 0) return 0;

  const now = new Date();
  const rows = matching.map((s) => ({
    id: randomUUID(),
    webhookId: s.id,
    tenantId,
    event,
    payload: payload as Record<string, unknown>,
    attempts: 0,
    status: "pending" as const,
    nextAttemptAt: now,
  }));
  // Insert directly — `tenantId` is already stamped per row, and scopedQuery
  // would re-stamp it fine but we want returning() for symmetry.
  await db.insert(tenantWebhookDeliveries).values(rows);
  return rows.length;
}

export async function listRecentDeliveries(
  ctx: Pick<TenantContext, "tenantId">,
  limit = 20,
): Promise<DeliveryDTO[]> {
  const rows = (await db
    .select()
    .from(tenantWebhookDeliveries)
    .where(eq(tenantWebhookDeliveries.tenantId, ctx.tenantId))
    .orderBy(desc(tenantWebhookDeliveries.createdAt))
    .limit(limit)) as TenantWebhookDelivery[];
  return rows.map(toDeliveryDTO);
}

function computeSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function backoffFor(attemptsAfter: number): Date {
  // attemptsAfter is the new `attempts` value (1..MAX_ATTEMPTS-1).
  const idx = Math.max(0, Math.min(BACKOFF_SCHEDULE_MS.length - 1, attemptsAfter - 1));
  const delay = BACKOFF_SCHEDULE_MS[idx];
  return new Date(Date.now() + (delay ?? 60_000));
}

type DispatcherDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/**
 * Pick up to `batchSize` pending deliveries whose `nextAttemptAt <= now`,
 * mark them `in_progress` (best-effort via row update — there's no separate
 * enum value, so we set status to 'pending' but bump attempts after issuing
 * the request), POST, then update the result.
 *
 * Concurrency note: this dispatcher is designed for a single cron lane. If
 * multiple workers run concurrently they may double-deliver an event — we
 * accept that for now and rely on consumer idempotency (we send a stable
 * `X-OA-Delivery` id).
 */
export async function dispatchPending(
  opts: { batchSize?: number } & DispatcherDeps = {},
): Promise<DispatchResult> {
  const batchSize = opts.batchSize ?? 50;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ? opts.now() : new Date();

  const due = (await db
    .select()
    .from(tenantWebhookDeliveries)
    .where(
      and(
        eq(tenantWebhookDeliveries.status, "pending"),
        lte(tenantWebhookDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(tenantWebhookDeliveries.nextAttemptAt))
    .limit(batchSize)) as TenantWebhookDelivery[];

  if (due.length === 0) {
    return { picked: 0, succeeded: 0, failed: 0, dead: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  // Cache per-webhook plaintext secret + url for the batch.
  const webhookCache = new Map<string, TenantWebhook | null>();
  const secretCache = new Map<string, string | null>();

  async function loadWebhook(id: string): Promise<TenantWebhook | null> {
    if (webhookCache.has(id)) return webhookCache.get(id) ?? null;
    const rows = (await db
      .select()
      .from(tenantWebhooks)
      .where(eq(tenantWebhooks.id, id))
      .limit(1)) as TenantWebhook[];
    const w = rows[0] ?? null;
    webhookCache.set(id, w);
    return w;
  }

  function loadSecret(w: TenantWebhook): string | null {
    if (secretCache.has(w.id)) return secretCache.get(w.id) ?? null;
    try {
      const plain = decrypt(w.secret, aadFor(w.tenantId));
      secretCache.set(w.id, plain);
      return plain;
    } catch (err) {
      console.warn("[webhooks] failed to decrypt secret", {
        webhookId: w.id,
        err: err instanceof Error ? err.message : String(err),
      });
      secretCache.set(w.id, null);
      return null;
    }
  }

  for (const delivery of due) {
    const webhook = await loadWebhook(delivery.webhookId);
    if (!webhook || !webhook.enabled) {
      // Parent disabled or deleted — mark dead so we stop scanning.
      await db
        .update(tenantWebhookDeliveries)
        .set({
          status: "dead",
          completedAt: new Date(),
          responseBody: "webhook_disabled_or_missing",
        })
        .where(eq(tenantWebhookDeliveries.id, delivery.id));
      dead += 1;
      continue;
    }
    const secret = loadSecret(webhook);
    if (!secret) {
      await db
        .update(tenantWebhookDeliveries)
        .set({
          status: "dead",
          completedAt: new Date(),
          responseBody: "secret_decrypt_failed",
        })
        .where(eq(tenantWebhookDeliveries.id, delivery.id));
      dead += 1;
      continue;
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      tenantId: delivery.tenantId,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });
    const signature = computeSignature(secret, body);
    const attempts = delivery.attempts + 1;

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let ok = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetchImpl(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OA-Event": delivery.event,
          "X-OA-Delivery": delivery.id,
          "X-OA-Signature": signature,
        },
        body,
        signal: controller.signal,
      });
      responseStatus = res.status;
      const text = await res.text().catch(() => "");
      responseBody = text.slice(0, 2000);
      ok = res.ok;
    } catch (err) {
      responseBody = (err instanceof Error ? err.message : String(err)).slice(
        0,
        2000,
      );
    } finally {
      clearTimeout(timeout);
    }

    const completedAt = new Date();
    if (ok) {
      await db
        .update(tenantWebhookDeliveries)
        .set({
          status: "success",
          attempts,
          responseStatus,
          responseBody,
          completedAt,
          nextAttemptAt: null,
        })
        .where(eq(tenantWebhookDeliveries.id, delivery.id));
      succeeded += 1;
    } else if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(tenantWebhookDeliveries)
        .set({
          status: "dead",
          attempts,
          responseStatus,
          responseBody,
          completedAt,
          nextAttemptAt: null,
        })
        .where(eq(tenantWebhookDeliveries.id, delivery.id));
      dead += 1;
    } else {
      const nextAttemptAt = backoffFor(attempts);
      await db
        .update(tenantWebhookDeliveries)
        .set({
          status: "pending",
          attempts,
          responseStatus,
          responseBody,
          nextAttemptAt,
        })
        .where(eq(tenantWebhookDeliveries.id, delivery.id));
      failed += 1;
    }

    // Update parent webhook's last-delivery summary.
    await db
      .update(tenantWebhooks)
      .set({
        lastDeliveryAt: completedAt,
        lastDeliveryStatus: responseStatus,
        updatedAt: completedAt,
      })
      .where(eq(tenantWebhooks.id, webhook.id));
  }

  return { picked: due.length, succeeded, failed, dead };
}

/**
 * Best-effort emit helper for call sites. Swallows everything — the parent
 * flow (session spawn etc.) must never break because of a webhook outage.
 */
export async function safeEnqueueEvent(
  tenantId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  try {
    await enqueueEvent(tenantId, event, payload);
  } catch (err) {
    console.warn("[webhooks] enqueue failed (non-fatal)", {
      tenantId,
      event,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Re-export for tests / callers that need the schedule constants.
export const __WEBHOOK_INTERNALS__ = {
  MAX_ATTEMPTS,
  BACKOFF_SCHEDULE_MS,
  computeSignature,
  // Tagged sql import to silence unused warning for future date math.
  _sql: sql,
};
