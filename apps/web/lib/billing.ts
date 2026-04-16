import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantStripeCustomers, tenants } from "@/lib/db/schema";
import type { TenantContext } from "@/lib/db/tenant-context";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

/**
 * Billing integration (Stripe).
 *
 * Layout:
 *   - `ensureStripeCustomer(ctx)` lazily creates the Stripe customer and
 *     upserts the `tenant_stripe_customers` row. Default plan is `free`
 *     until a checkout session converts the tenant.
 *   - `getPlan(ctx)` reads the cached plan row. Missing row ⇒ free.
 *   - `assertPlanAllows(ctx, feature)` raises `PlanUpgradeRequired` when
 *     the feature isn't included in the tenant's plan.
 *   - `recordStripeUsage(ctx, kind, quantity)` emits a Stripe meter event.
 *     Named `recordStripeUsage` to avoid colliding with `recordUsage` in
 *     `lib/db/usage.ts` (per-user token usage logged to our own DB).
 *
 * `tenant_id` is always sourced from the server-resolved `TenantContext`.
 * Callers must never pass a raw id.
 */

export type Plan = "free" | "pro" | "team" | "enterprise";

export type PlanFeature =
  | "concurrent_sandboxes"
  | "byo_keys"
  | "sso";

/**
 * Plan matrix — single source of truth. Keep in sync with marketing pages.
 * `concurrent_sandboxes: number | 'custom'` — `custom` means "negotiated
 * at enterprise onboarding", gate passes unconditionally.
 */
export const PLAN_MATRIX: Record<
  Plan,
  {
    concurrent_sandboxes: number | "custom";
    byo_keys: boolean;
    sso: boolean;
    /**
     * Per-tenant API rate limit (wave 2A). `rpm` is the sustained
     * requests/minute ceiling; `burst` is short-term additive cushion above
     * the sustained rate within the same 60s sliding window.
     */
    rateLimit: { rpm: number; burst: number };
  }
> = {
  free: {
    concurrent_sandboxes: 1,
    byo_keys: false,
    sso: false,
    rateLimit: { rpm: 60, burst: 30 },
  },
  pro: {
    concurrent_sandboxes: 3,
    byo_keys: true,
    sso: false,
    rateLimit: { rpm: 600, burst: 120 },
  },
  team: {
    concurrent_sandboxes: 10,
    byo_keys: true,
    sso: false,
    rateLimit: { rpm: 3000, burst: 500 },
  },
  enterprise: {
    concurrent_sandboxes: "custom",
    byo_keys: true,
    sso: true,
    rateLimit: { rpm: 10000, burst: 2000 },
  },
};

/**
 * Return the plan's `{ rpm, burst }` rate-limit ceiling. Callers typically
 * multiply `rpm`/`burst` by 5x for read buckets (see `withRateLimit`).
 */
export function getRateLimitForPlan(plan: Plan): { rpm: number; burst: number } {
  return PLAN_MATRIX[plan].rateLimit;
}

export class PlanUpgradeRequired extends Error {
  readonly feature: PlanFeature;
  readonly currentPlan: Plan;
  constructor(feature: PlanFeature, currentPlan: Plan) {
    super(`Plan upgrade required for feature=${feature} (current=${currentPlan})`);
    this.name = "PlanUpgradeRequired";
    this.feature = feature;
    this.currentPlan = currentPlan;
  }
}

type Ctx = { tenantId: string; userId?: string };

/**
 * Read the tenant's plan. Free tier is the implicit default when no
 * customer row exists (tenant hasn't hit a paid feature yet).
 */
export async function getPlan(ctx: Pick<TenantContext, "tenantId">): Promise<Plan> {
  const [row] = await db
    .select({ plan: tenantStripeCustomers.plan })
    .from(tenantStripeCustomers)
    .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
    .limit(1);
  return (row?.plan as Plan | undefined) ?? "free";
}

/**
 * Throw `PlanUpgradeRequired` when the tenant's plan doesn't include
 * `feature`. For `concurrent_sandboxes` this function is a no-op — the
 * numeric cap is enforced by the existing quota gate; call sites that
 * want the cap should read `PLAN_MATRIX[plan].concurrent_sandboxes`.
 */
export async function assertPlanAllows(
  ctx: Pick<TenantContext, "tenantId">,
  feature: PlanFeature,
): Promise<void> {
  const plan = await getPlan(ctx);
  const row = PLAN_MATRIX[plan];
  if (feature === "byo_keys" && !row.byo_keys) {
    throw new PlanUpgradeRequired(feature, plan);
  }
  if (feature === "sso" && !row.sso) {
    throw new PlanUpgradeRequired(feature, plan);
  }
  // concurrent_sandboxes is enforced numerically elsewhere.
}

/**
 * Ensure a Stripe customer exists for the tenant; lazily create one on
 * first access. Idempotent — concurrent callers converge because
 * `stripe_customer_id` is unique and we re-read the row after insert
 * failures.
 */
export async function ensureStripeCustomer(ctx: Ctx): Promise<string> {
  const existing = await db
    .select({ stripeCustomerId: tenantStripeCustomers.stripeCustomerId })
    .from(tenantStripeCustomers)
    .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
    .limit(1);
  if (existing[0]?.stripeCustomerId) return existing[0].stripeCustomerId;

  if (!isStripeConfigured()) {
    throw new Error(
      "Stripe not configured — cannot create customer. Set STRIPE_SECRET_KEY.",
    );
  }

  // Look up tenant name for Stripe metadata / display.
  const [tenant] = await db
    .select({ name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: tenant?.name ?? tenant?.slug ?? ctx.tenantId,
    metadata: {
      tenantId: ctx.tenantId,
      ...(ctx.userId ? { createdByUserId: ctx.userId } : {}),
    },
  });

  try {
    await db
      .insert(tenantStripeCustomers)
      .values({
        tenantId: ctx.tenantId,
        stripeCustomerId: customer.id,
        plan: "free",
      })
      .onConflictDoNothing({ target: tenantStripeCustomers.tenantId });
  } catch (error) {
    // Another writer won the race — re-read and discard our Stripe customer.
    const [row] = await db
      .select({ stripeCustomerId: tenantStripeCustomers.stripeCustomerId })
      .from(tenantStripeCustomers)
      .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
      .limit(1);
    if (row?.stripeCustomerId && row.stripeCustomerId !== customer.id) {
      // Best-effort cleanup of the losing customer.
      try {
        await stripe.customers.del(customer.id);
      } catch {
        /* ignore */
      }
      return row.stripeCustomerId;
    }
    throw error;
  }

  // If ON CONFLICT DO NOTHING hit an existing row, re-read.
  const [row] = await db
    .select({ stripeCustomerId: tenantStripeCustomers.stripeCustomerId })
    .from(tenantStripeCustomers)
    .where(eq(tenantStripeCustomers.tenantId, ctx.tenantId))
    .limit(1);
  if (!row?.stripeCustomerId) {
    throw new Error("Failed to upsert tenant_stripe_customers row");
  }
  if (row.stripeCustomerId !== customer.id) {
    // Another writer won — clean up.
    try {
      await stripe.customers.del(customer.id);
    } catch {
      /* ignore */
    }
  }
  return row.stripeCustomerId;
}

export type UsageKind = "sandbox_minutes" | "tokens_in" | "tokens_out";

/**
 * Emit a Stripe meter event for tenant usage. Event names follow
 * `oa_<kind>`. Idempotency key is derived from tenant + kind + minute
 * bucket so transient retries within a minute dedupe, while legitimate
 * streaming workloads coalesce to at most one event per minute (Stripe
 * meter events sum values server-side).
 *
 * Fire-and-forget friendly: failures are logged, never thrown, so metering
 * cannot take down a user-facing request.
 */
export async function recordStripeUsage(
  ctx: Ctx,
  kind: UsageKind,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) return;
  if (!isStripeConfigured()) return;
  try {
    const stripeCustomerId = await ensureStripeCustomer(ctx);
    const stripe = getStripe();
    const bucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = `${ctx.tenantId}-${kind}-${bucket}`;
    // v2 meter events API. The SDK surface has shifted across versions;
    // use `any` to stay resilient. If `v2` isn't present, fall back to
    // v1 `billing.meterEvents.create`.
    // biome-ignore lint/suspicious/noExplicitAny: SDK surface varies
    const s = stripe as any;
    const payload = {
      event_name: `oa_${kind}`,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: String(quantity),
      },
      identifier: idempotencyKey,
    };
    if (s.v2?.billing?.meterEvents?.create) {
      await s.v2.billing.meterEvents.create(payload);
    } else if (s.billing?.meterEvents?.create) {
      await s.billing.meterEvents.create(payload);
    } else {
      // No meter-events API available on this SDK — log and skip.
      // eslint-disable-next-line no-console
      console.warn("[billing] Stripe meter events API not available on SDK");
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "billing.record_usage_failed",
        tenantId: ctx.tenantId,
        kind,
        quantity,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Fire-and-forget wrapper for recordStripeUsage — attach with `void` to
 * keep request paths from awaiting Stripe I/O.
 */
export function recordStripeUsageAsync(
  ctx: Ctx,
  kind: UsageKind,
  quantity: number,
): void {
  void recordStripeUsage(ctx, kind, quantity).catch(() => {
    /* already logged */
  });
}
