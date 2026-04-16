import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenantSsoConfigs } from "@/lib/db/schema";

/**
 * SSO scaffolding (P3, enterprise plan only).
 *
 * This module intentionally does NOT depend on WorkOS, Clerk, or any other
 * SSO SDK. Its only job is to define:
 *
 *   1. A `SsoAdapter` interface that concrete provider adapters will
 *      implement once an operator wires them up on their fork.
 *   2. `getSsoAdapter(provider)` — returns a stub adapter that throws
 *      `SsoNotConfigured` with a message pointing at the env vars the
 *      operator needs to set.
 *   3. `lookupSsoForDomain(email)` — reads the `tenant_sso_configs` table
 *      and, if an enabled row matches the email's domain, returns the
 *      config. Future login routes (not implemented here) will use this
 *      to route enterprise logins to their tenant's configured provider
 *      before falling back to the default GitHub / Vercel OAuth flows.
 *
 * To actually wire SSO:
 *   - Install the provider SDK (`workos`, `@clerk/backend`, …).
 *   - Replace the corresponding stub in `STUB_ADAPTERS` with a real
 *     implementation.
 *   - Set the env vars named in the `SsoNotConfigured` message.
 */

export type SsoProvider = "workos" | "clerk" | "saml-generic";

export interface SsoAdapter {
  /**
   * Begin the SSO handshake. Returns the URL the browser should be
   * redirected to. `returnTo` is the post-auth landing URL; the callback
   * route is expected to preserve it and redirect there on success.
   */
  initiate(
    domain: string,
    returnTo: string,
  ): Promise<{ redirectUrl: string }>;

  /**
   * Complete the SSO handshake given the callback query params. Returns
   * the verified user identity plus the tenant to attach them to (looked
   * up via the matched SSO config's `tenant_id`).
   */
  complete(params: URLSearchParams): Promise<{
    email: string;
    externalId: string;
    name?: string;
    tenantId: string;
  }>;
}

export class SsoNotConfigured extends Error {
  readonly provider: SsoProvider;
  readonly envVars: string[];
  constructor(provider: SsoProvider, envVars: string[]) {
    super(
      `SSO provider '${provider}' is not configured. Set ${envVars.join(
        ", ",
      )} and wire the adapter in apps/web/lib/sso/index.ts.`,
    );
    this.name = "SsoNotConfigured";
    this.provider = provider;
    this.envVars = envVars;
  }
}

function stubAdapter(provider: SsoProvider, envVars: string[]): SsoAdapter {
  return {
    async initiate() {
      throw new SsoNotConfigured(provider, envVars);
    },
    async complete() {
      throw new SsoNotConfigured(provider, envVars);
    },
  };
}

const STUB_ADAPTERS: Record<SsoProvider, SsoAdapter> = {
  workos: stubAdapter("workos", ["WORKOS_API_KEY", "WORKOS_CLIENT_ID"]),
  clerk: stubAdapter("clerk", ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"]),
  "saml-generic": stubAdapter("saml-generic", [
    "SAML_IDP_METADATA_URL",
    "SAML_SP_ENTITY_ID",
  ]),
};

/**
 * Return the adapter for a given provider. Currently always a stub that
 * throws `SsoNotConfigured` — operators swap in real implementations on
 * their fork. Centralising the lookup keeps call sites provider-agnostic.
 */
export function getSsoAdapter(provider: SsoProvider): SsoAdapter {
  const adapter = STUB_ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown SSO provider: ${provider}`);
  }
  return adapter;
}

/**
 * Given an email address, find an enabled `tenant_sso_configs` row whose
 * `domain` matches the email domain. Used by future login routes to
 * route enterprise users to their tenant's configured provider.
 *
 * Returns `null` when no match or when the tenant hasn't enabled SSO.
 */
export async function lookupSsoForDomain(email: string): Promise<{
  tenantId: string;
  provider: SsoProvider;
  connectionId: string | null;
  domain: string;
} | null> {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;

  const [row] = await db
    .select({
      tenantId: tenantSsoConfigs.tenantId,
      provider: tenantSsoConfigs.provider,
      connectionId: tenantSsoConfigs.connectionId,
      domain: tenantSsoConfigs.domain,
    })
    .from(tenantSsoConfigs)
    .where(
      and(
        eq(tenantSsoConfigs.enabled, true),
        eq(tenantSsoConfigs.domain, domain),
      ),
    )
    .limit(1);

  if (!row || !row.domain) return null;
  return {
    tenantId: row.tenantId,
    provider: row.provider as SsoProvider,
    connectionId: row.connectionId,
    domain: row.domain,
  };
}
