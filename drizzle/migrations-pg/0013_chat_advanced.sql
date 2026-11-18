ALTER TABLE "chat_conversations" ADD COLUMN "post_policy" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "parent_message_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "reply_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "last_reply_at" bigint;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "sticker_id" text;--> statement-breakpoint
CREATE TABLE "chat_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"uploader_user_id" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"r2_key" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_stickers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'sticker' NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"r2_key" text NOT NULL,
	"created_by_user_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_stickers" ADD CONSTRAINT "chat_stickers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_parent_idx" ON "chat_messages" USING btree ("parent_message_id","sent_at");--> statement-breakpoint
CREATE INDEX "chat_attachments_message_idx" ON "chat_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_conversation_idx" ON "chat_attachments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_uploader_idx" ON "chat_attachments" USING btree ("uploader_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reactions_message_user_emoji_idx" ON "chat_reactions" USING btree ("message_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "chat_stickers_kind_idx" ON "chat_stickers" USING btree ("kind","created_at");
