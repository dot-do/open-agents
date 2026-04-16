CREATE TABLE "tenant_quotas" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"max_concurrent_sandboxes" integer DEFAULT 3 NOT NULL,
	"max_monthly_minutes" integer DEFAULT 600 NOT NULL,
	"max_daily_cost_cents" integer DEFAULT 500 NOT NULL,
	"hard_kill_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_usage_counters" (
	"tenant_id" text NOT NULL,
	"period_start" date NOT NULL,
	"sandbox_minutes" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_usage_counters_tenant_id_period_start_pk" PRIMARY KEY("tenant_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "tenant_quotas" ADD CONSTRAINT "tenant_quotas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_usage_counters" ADD CONSTRAINT "tenant_usage_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_usage_counters_tenant_idx" ON "tenant_usage_counters" USING btree ("tenant_id");