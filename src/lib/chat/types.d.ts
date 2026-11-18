export type ChatUserDto = {
	id: string;
	name: string;
	email: string;
	avatarUrl: string | null;
};

export type ChatMemberRole = "owner" | "admin" | "member";

/** Who may start new messages in a space: everyone, only owner/admins, or admins post and everyone replies in threads. */
export type ChatPostPolicy = "everyone" | "admins" | "admins_threads";

export type ChatMemberDto = ChatUserDto & { role: ChatMemberRole };

export type ChatAttachmentDto = {
	id: string;
	name: string;
	size: number;
	contentType: string;
	url: string;
	image: boolean;
};

export type ChatStickerKind = "sticker" | "gif";

export type ChatStickerDto = {
	id: string;
	kind: ChatStickerKind;
	name: string;
	url: string;
	createdByUserId?: string | null;
};

export type ChatReactionDto = {
	emoji: string;
	count: number;
	userIds: string[];
};

export type ChatMessageDto = {
	id: string;
	conversationId: string;
	senderUserId: string | null;
	senderName: string | null;
	body: string;
	sentAt: number;
	editedAt: number | null;
	parentMessageId: string | null;
	replyCount: number;
	lastReplyAt: number | null;
	sticker: ChatStickerDto | null;
	attachments: ChatAttachmentDto[];
	reactions: ChatReactionDto[];
};

export type ChatConversationDto = {
	id: string;
	type: "direct" | "space";
	name: string | null;
	role: ChatMemberRole;
	postPolicy: ChatPostPolicy;
	/** May start new top-level messages. */
	canPost: boolean;
	/** May reply in threads. */
	canReply: boolean;
	members: ChatMemberDto[];
	lastMessage: ChatMessageDto | null;
	lastMessageAt: number;
	lastReadAt: number;
	unreadCount: number;
};

export type ChatRealtimeEvent = {
	type: "chat";
	event: "message" | "conversation" | "read" | "update" | "delete";
	conversationId: string;
	message?: ChatMessageDto;
	/** For "delete": the removed message and, for a thread reply, its parent. */
	messageId?: string;
	parentMessageId?: string | null;
};

export type ChatConversationParams = { params: Promise<{ id: string }> };
export type ChatMessageParams = { params: Promise<{ messageId: string }> };
