import "server-only";

import Stripe from "stripe";

/**
 * Shared Stripe client for the web app.
 *
 * Constructed lazily so module import doesn't crash in environments where
 * Stripe isn't configured (e.g. preview envs without billing). We fail
 * closed in production when the secret is missing, and warn-only in dev
 * so local workflows that don't touch billing still run.
 */
let cached: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor(message = "STRIPE_SECRET_KEY is not set") {
    super(message);
    this.name = "StripeNotConfiguredError";
  }
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new StripeNotConfiguredError();
    }
    // In dev, warn once then throw — callers that don't actually hit the
    // network won't touch this function, and callers that do should get
    // a clear error rather than a cryptic auth failure from Stripe.
    // eslint-disable-next-line no-console
    console.warn(
      "[stripe] STRIPE_SECRET_KEY not set — billing endpoints will fail",
    );
    throw new StripeNotConfiguredError();
  }
  cached = new Stripe(key, {
    // Pin API version so responses don't drift under us; Stripe always
    // allows the account default when omitted but we want determinism.
    // biome-ignore lint/suspicious/noExplicitAny: SDK versions update quickly
    apiVersion: (process.env.STRIPE_API_VERSION ?? "2024-12-18.acacia") as any,
    appInfo: {
      name: "open-agents",
    },
  });
  return cached;
}

export type { Stripe };
