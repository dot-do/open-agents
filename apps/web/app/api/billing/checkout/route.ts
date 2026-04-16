import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { ensureStripeCustomer } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/billing/checkout
 * Body: { plan: 'pro' | 'team' }
 *
 * Returns a Stripe Checkout Session URL for upgrading the active tenant.
 * Price IDs are read from `STRIPE_PRICE_ID_<plan>` env vars so ops can
 * swap them per-env without code changes.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let ctx;
  try {
    ctx = await requireTenantCtx(req);
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  let body: { plan?: string } = {};
  try {
    body = (await req.json()) as { plan?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = body.plan;
  if (plan !== "pro" && plan !== "team") {
    return NextResponse.json(
      { error: "invalid_plan", detail: "plan must be 'pro' or 'team'" },
      { status: 400 },
    );
  }

  const priceId =
    plan === "pro"
      ? process.env.STRIPE_PRICE_ID_PRO
      : process.env.STRIPE_PRICE_ID_TEAM;
  if (!priceId) {
    return NextResponse.json(
      { error: "plan_not_configured", detail: `STRIPE_PRICE_ID_${plan.toUpperCase()} missing` },
      { status: 500 },
    );
  }

  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin;

  try {
    const customerId = await ensureStripeCustomer(ctx);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/settings/billing?status=success`,
      cancel_url: `${origin}/settings/billing?status=cancelled`,
      subscription_data: {
        metadata: { tenantId: ctx.tenantId, plan },
      },
      metadata: { tenantId: ctx.tenantId, plan },
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[billing] checkout failed:", error);
    return NextResponse.json(
      {
        error: "checkout_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
