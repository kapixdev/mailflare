ALTER TABLE `chat_conversations` ADD `post_policy` varchar(64) NOT NULL DEFAULT 'everyone';--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `parent_message_id` varchar(191);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `reply_count` bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `last_reply_at` bigint;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `sticker_id` varchar(191);--> statement-breakpoint
CREATE TABLE `chat_attachments` (
	`id` varchar(191) NOT NULL,
	`conversation_id` varchar(191) NOT NULL,
	`message_id` varchar(191),
	`uploader_user_id` varchar(191),
	`name` longtext NOT NULL,
	`content_type` varchar(255) NOT NULL,
	`size` bigint NOT NULL,
	`r2_key` varchar(512) NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `chat_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_reactions` (
	`id` varchar(191) NOT NULL,
	`message_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`emoji` varchar(64) NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `chat_reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_reactions_message_user_emoji_idx` UNIQUE(`message_id`,`user_id`,`emoji`)
);
--> statement-breakpoint
CREATE TABLE `chat_stickers` (
	`id` varchar(191) NOT NULL,
	`kind` varchar(64) NOT NULL DEFAULT 'sticker',
	`name` longtext NOT NULL,
	`content_type` varchar(255) NOT NULL,
	`size` bigint NOT NULL,
	`r2_key` varchar(512) NOT NULL,
	`created_by_user_id` varchar(191),
	`created_at` bigint NOT NULL,
	CONSTRAINT `chat_stickers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_conversation_id_chat_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_attachments` ADD CONSTRAINT `chat_attachments_uploader_user_id_users_id_fk` FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_reactions` ADD CONSTRAINT `chat_reactions_message_id_chat_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_reactions` ADD CONSTRAINT `chat_reactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_stickers` ADD CONSTRAINT `chat_stickers_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_messages_parent_idx` ON `chat_messages` (`parent_message_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `chat_attachments_message_idx` ON `chat_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `chat_attachments_conversation_idx` ON `chat_attachments` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `chat_attachments_uploader_idx` ON `chat_attachments` (`uploader_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_stickers_kind_idx` ON `chat_stickers` (`kind`,`created_at`);
