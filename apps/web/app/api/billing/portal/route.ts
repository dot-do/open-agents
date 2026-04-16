import { NextResponse, type NextRequest } from "next/server";
import { requireTenantCtx, TenantAccessError } from "@/lib/db/tenant-context";
import { ensureStripeCustomer } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/billing/portal
 * Returns a Stripe Billing Portal URL so the tenant owner can manage
 * payment method, invoices, and cancel/upgrade.
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

  const origin =
    req.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(req.url).origin;

  try {
    const customerId = await ensureStripeCustomer(ctx);
    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    console.error("[billing] portal failed:", error);
    return NextResponse.json(
      {
        error: "portal_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
