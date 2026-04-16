import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantStripeCustomers } from "@/lib/db/schema";
import { getStripe, type Stripe } from "@/lib/stripe";

/**
 * Stripe webhook endpoint.
 *
 * Middleware excludes /api/webhooks/* from auth per wave 2, so signature
 * verification below is the only authentication. Returns 200 on handled
 * events and 400 on signature failure so Stripe surfaces real deliveries
 * correctly in the dashboard.
 *
 * Handled events:
 *   - checkout.session.completed
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *
 * All mutations emit a `billing.plan_changed` audit event (lazy import so
 * the audit module's absence doesn't break webhook delivery).
 */

export const config = {
  api: { bodyParser: false },
};

type HandledEvent =
  | "checkout.session.completed"
  | "customer.subscription.updated"
  | "customer.subscription.deleted";

const HANDLED: ReadonlySet<HandledEvent> = new Set<HandledEvent>([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function priceIdToPlan(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ID_TEAM) return "team";
  if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE) return "enterprise";
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 500 },
    );
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  // Must use the raw body for signature verification.
  const rawBody = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (error) {
    console.warn(
      "[stripe.webhook] signature verification failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type as HandledEvent)) {
    // Acknowledge unhandled events so Stripe stops retrying.
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId =
        (session.metadata?.tenantId as string | undefined) ?? null;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (tenantId && customerId) {
        let plan: string | null = null;
        let status: string | null = null;
        let periodEnd: Date | null = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          plan = priceIdToPlan(sub.items.data[0]?.price?.id);
          status = sub.status;
          // biome-ignore lint/suspicious/noExplicitAny: Stripe type drift
          const anySub = sub as any;
          const endSec =
            anySub.current_period_end ??
            anySub.items?.data?.[0]?.current_period_end ??
            null;
          if (typeof endSec === "number") {
            periodEnd = new Date(endSec * 1000);
          }
        }
        await applyPlanChange({
          tenantId,
          stripeCustomerId: customerId,
          plan: plan ?? (session.metadata?.plan as string | undefined) ?? null,
          subscriptionId: subscriptionId ?? null,
          subscriptionStatus: status,
          currentPeriodEnd: periodEnd,
        });
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const [row] = await db
        .select({ tenantId: tenantStripeCustomers.tenantId })
        .from(tenantStripeCustomers)
        .where(eq(tenantStripeCustomers.stripeCustomerId, customerId))
        .limit(1);
      if (row?.tenantId) {
        const plan =
          event.type === "customer.subscription.deleted"
            ? "free"
            : priceIdToPlan(sub.items.data[0]?.price?.id);
        // biome-ignore lint/suspicious/noExplicitAny: Stripe type drift
        const anySub = sub as any;
        const endSec =
          anySub.current_period_end ??
          anySub.items?.data?.[0]?.current_period_end ??
          null;
        await applyPlanChange({
          tenantId: row.tenantId,
          stripeCustomerId: customerId,
          plan,
          subscriptionId: sub.id,
          subscriptionStatus: sub.status,
          currentPeriodEnd:
            typeof endSec === "number" ? new Date(endSec * 1000) : null,
        });
      }
    }
  } catch (error) {
    console.error("[stripe.webhook] handler failed:", error);
    return NextResponse.json(
      { error: "handler_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, handled: true });
}

async function applyPlanChange(params: {
  tenantId: string;
  stripeCustomerId: string;
  plan: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const [current] = await db
    .select({ plan: tenantStripeCustomers.plan })
    .from(tenantStripeCustomers)
    .where(eq(tenantStripeCustomers.tenantId, params.tenantId))
    .limit(1);
  const previousPlan = current?.plan ?? null;

  const validPlans = new Set(["free", "pro", "team", "enterprise"]);
  const nextPlan =
    params.plan && validPlans.has(params.plan)
      ? (params.plan as "free" | "pro" | "team" | "enterprise")
      : (previousPlan as "free" | "pro" | "team" | "enterprise" | null) ??
        "free";

  await db
    .insert(tenantStripeCustomers)
    .values({
      tenantId: params.tenantId,
      stripeCustomerId: params.stripeCustomerId,
      plan: nextPlan,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: params.subscriptionStatus,
      currentPeriodEnd: params.currentPeriodEnd,
    })
    .onConflictDoUpdate({
      target: tenantStripeCustomers.tenantId,
      set: {
        stripeCustomerId: params.stripeCustomerId,
        plan: nextPlan,
        subscriptionId: params.subscriptionId,
        subscriptionStatus: params.subscriptionStatus,
        currentPeriodEnd: params.currentPeriodEnd,
        updatedAt: new Date(),
      },
    });

  if (previousPlan !== nextPlan) {
    // Lazy import so an audit-module outage can't break webhook delivery.
    try {
      const { audit } = await import("@/lib/audit");
      await audit(
        { tenantId: params.tenantId, userId: "stripe-webhook" },
        "billing.plan_changed",
        {
          target: params.stripeCustomerId,
          metadata: {
            previousPlan,
            plan: nextPlan,
            subscriptionStatus: params.subscriptionStatus,
          },
        },
      );
    } catch (error) {
      console.warn("[stripe.webhook] audit emit failed:", error);
    }
  }
}
