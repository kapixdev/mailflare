CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'direct' NOT NULL,
	`name` text,
	`direct_key` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`last_message_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_conversations_direct_key_idx` ON `chat_conversations` (`direct_key`);
--> statement-breakpoint
CREATE TABLE `chat_members` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`last_read_at` integer DEFAULT 0 NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_members_conversation_user_idx` ON `chat_members` (`conversation_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `chat_members_user_idx` ON `chat_members` (`user_id`);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender_user_id` text,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_sent_idx` ON `chat_messages` (`conversation_id`,`sent_at`);
--> statement-breakpoint
CREATE INDEX `chat_messages_sender_idx` ON `chat_messages` (`sender_user_id`);
