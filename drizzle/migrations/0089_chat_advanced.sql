ALTER TABLE `chat_conversations` ADD `post_policy` text DEFAULT 'everyone' NOT NULL;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `parent_message_id` text;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `reply_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `last_reply_at` integer;
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `sticker_id` text;
--> statement-breakpoint
CREATE INDEX `chat_messages_parent_idx` ON `chat_messages` (`parent_message_id`,`sent_at`);
--> statement-breakpoint
CREATE TABLE `chat_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`uploader_user_id` text,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_attachments_message_idx` ON `chat_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `chat_attachments_conversation_idx` ON `chat_attachments` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `chat_attachments_uploader_idx` ON `chat_attachments` (`uploader_user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `chat_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_reactions_message_user_emoji_idx` ON `chat_reactions` (`message_id`,`user_id`,`emoji`);
--> statement-breakpoint
CREATE TABLE `chat_stickers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'sticker' NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_stickers_kind_idx` ON `chat_stickers` (`kind`,`created_at`);
