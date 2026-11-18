CREATE TABLE `chat_conversations` (
	`id` varchar(191) NOT NULL,
	`type` varchar(64) NOT NULL DEFAULT 'direct',
	`name` longtext,
	`direct_key` varchar(191),
	`created_by_user_id` varchar(191),
	`created_at` bigint NOT NULL,
	`last_message_at` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `chat_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_conversations_direct_key_idx` UNIQUE(`direct_key`)
);
--> statement-breakpoint
CREATE TABLE `chat_members` (
	`id` varchar(191) NOT NULL,
	`conversation_id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`role` varchar(64) NOT NULL DEFAULT 'member',
	`last_read_at` bigint NOT NULL DEFAULT 0,
	`joined_at` bigint NOT NULL,
	CONSTRAINT `chat_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_members_conversation_user_idx` UNIQUE(`conversation_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(191) NOT NULL,
	`conversation_id` varchar(191) NOT NULL,
	`sender_user_id` varchar(191),
	`body` longtext NOT NULL,
	`sent_at` bigint NOT NULL,
	`edited_at` bigint,
	`deleted_at` bigint,
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD CONSTRAINT `chat_conversations_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_conversation_id_chat_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_conversation_id_chat_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_sender_user_id_users_id_fk` FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_members_user_idx` ON `chat_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_sent_idx` ON `chat_messages` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `chat_messages_sender_idx` ON `chat_messages` (`sender_user_id`);
