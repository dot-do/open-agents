-- Tenant RLS (wave 3, defense-in-depth).
--
-- Enables Postgres row-level security on tenant-scoped tables. Policies
-- compare `tenant_id` to `current_setting('app.tenant_id', true)::text`
-- which the app sets per-transaction via
-- `apps/web/lib/db/rls.ts#setTenantContext`.
--
-- NOTE: RLS is a secondary control. The primary tenant-isolation guarantee
-- is the app-level query guard in `apps/web/lib/db/tenant-guard.ts`. RLS
-- only fires when a transaction has primed `app.tenant_id`; unprimed
-- transactions (`current_setting(..., true)` returns NULL) match nothing.
--
-- The Postgres role used by the app needs permission to set the custom
-- GUC `app.tenant_id`. Supabase / Neon / RDS grant this to the default
-- app role. If deploying to a hardened cluster you may need:
--   ALTER DATABASE <db> SET "app.tenant_id" = '';
-- or a grant on `pg_catalog.set_config`. Superusers + the table owner
-- always bypass RLS — run migrations as a superuser / owner role.
--
-- Additive only: no column changes, no data movement.

-- Enable RLS on every tenant-scoped table.
ALTER TABLE "sessions"                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chats"                   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages"           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shares"                  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_runs"           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_run_steps"      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_installations"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vercel_project_links"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "linked_accounts"         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_preferences"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_events"            ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_quotas"           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_usage_counters"   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events"            ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_api_keys"         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_stripe_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_invites"          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships"             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Policies. All follow the same shape: match when the session GUC equals
-- the row's tenant_id. `tenant_id`-keyed tables vs PK-keyed tables both
-- have a `tenant_id` column, so the predicate is uniform.

CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "chats_tenant_isolation" ON "chats"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "chat_messages_tenant_isolation" ON "chat_messages"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "shares_tenant_isolation" ON "shares"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "workflow_runs_tenant_isolation" ON "workflow_runs"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "workflow_run_steps_tenant_isolation" ON "workflow_run_steps"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "github_installations_tenant_isolation" ON "github_installations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "vercel_project_links_tenant_isolation" ON "vercel_project_links"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "linked_accounts_tenant_isolation" ON "linked_accounts"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "user_preferences_tenant_isolation" ON "user_preferences"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "usage_events_tenant_isolation" ON "usage_events"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "tenant_quotas_tenant_isolation" ON "tenant_quotas"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "tenant_usage_counters_tenant_isolation" ON "tenant_usage_counters"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "audit_events_tenant_isolation" ON "audit_events"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "tenant_api_keys_tenant_isolation" ON "tenant_api_keys"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "tenant_stripe_customers_tenant_isolation" ON "tenant_stripe_customers"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "tenant_invites_tenant_isolation" ON "tenant_invites"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint

CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
