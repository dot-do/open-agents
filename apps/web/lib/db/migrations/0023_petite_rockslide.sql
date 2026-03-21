CREATE TABLE "chat_external_replies" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"chat_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "chat_external_replies" ADD CONSTRAINT "chat_external_replies_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;