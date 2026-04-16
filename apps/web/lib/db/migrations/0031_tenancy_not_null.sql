-- Tighten tenant_id to NOT NULL on all tenant-scoped tables.
-- Runs after 0030_tenancy_backfill.sql has populated the column.
-- Note: schema.ts still declares tenant_id as nullable to allow a staged
-- rollout; a follow-up schema change will align the type with reality.

ALTER TABLE "sessions"             ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chats"                ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shares"               ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages"        ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs"        ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_steps"   ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vercel_project_links" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "github_installations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_accounts"      ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences"     ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events"         ALTER COLUMN "tenant_id" SET NOT NULL;