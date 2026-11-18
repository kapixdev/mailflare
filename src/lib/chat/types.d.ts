export type ChatUserDto = {
	id: string;
	name: string;
	email: string;
	avatarUrl: string | null;
};

export type ChatMessageDto = {
	id: string;
	conversationId: string;
	senderUserId: string | null;
	senderName: string | null;
	body: string;
	sentAt: number;
	editedAt: number | null;
};

export type ChatConversationDto = {
	id: string;
	type: "direct" | "space";
	name: string | null;
	role: "owner" | "member";
	members: ChatUserDto[];
	lastMessage: ChatMessageDto | null;
	lastMessageAt: number;
	lastReadAt: number;
	unreadCount: number;
};

export type ChatRealtimeEvent = {
	type: "chat";
	event: "message" | "conversation" | "read";
	conversationId: string;
	message?: ChatMessageDto;
};

export type ChatConversationParams = { params: Promise<{ id: string }> };
