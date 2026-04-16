-- Tenant SSO scaffolding (P3, enterprise plan only).
--
-- One row per tenant stores the active SSO connection the tenant has
-- configured with a platform-side provider (WorkOS, Clerk, or a generic
-- SAML broker). The app-side code reads this row to route enterprise
-- logins; the provider SDK is intentionally NOT installed in this repo.
-- Operators wire it up via env vars and the platform dashboard — see
-- `apps/web/lib/sso/index.ts` and docs/SELF_HOST_MULTITENANT.md.
--
-- Additive only: no column changes to existing tables.

CREATE TABLE IF NOT EXISTS "tenant_sso_configs" (
  "tenant_id"     text PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider"      text NOT NULL,
  "connection_id" text,
  "domain"        text,
  "enabled"       boolean NOT NULL DEFAULT false,
  "metadata"      jsonb,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tenant_sso_configs_domain_idx"
  ON "tenant_sso_configs" ("domain");
