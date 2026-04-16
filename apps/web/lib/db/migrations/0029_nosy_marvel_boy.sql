CREATE TABLE "memberships" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "tenant_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ADD CONSTRAINT "vercel_project_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_tenant_chat_idx" ON "chat_messages" USING btree ("tenant_id","chat_id");--> statement-breakpoint
CREATE INDEX "chats_tenant_session_idx" ON "chats" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "github_installations_tenant_user_idx" ON "github_installations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "linked_accounts_tenant_user_idx" ON "linked_accounts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_user_idx" ON "sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "shares_tenant_chat_idx" ON "shares" USING btree ("tenant_id","chat_id");--> statement-breakpoint
CREATE INDEX "usage_events_tenant_user_idx" ON "usage_events" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_preferences_tenant_user_idx" ON "user_preferences" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "vercel_project_links_tenant_user_idx" ON "vercel_project_links" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "workflow_run_steps_tenant_run_idx" ON "workflow_run_steps" USING btree ("tenant_id","workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_tenant_user_idx" ON "workflow_runs" USING btree ("tenant_id","user_id");