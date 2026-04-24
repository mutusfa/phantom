// Binary content carried through the channel layer into the agent runtime.
// Images flow as base64 so they can be passed directly as Anthropic image
// content blocks without a second network round-trip.
export type MessageAttachment = {
	kind: "image";
	mediaType: string;
	dataBase64: string;
	name?: string;
};

export type InboundMessage = {
	id: string;
	channelId: string;
	conversationId: string;
	threadId?: string;
	senderId: string;
	senderName?: string;
	text: string;
	timestamp: Date;
	attachments?: MessageAttachment[];
	metadata?: Record<string, unknown>;
};

export type OutboundMessage = {
	text: string;
	threadId?: string;
	replyToId?: string;
};

export type SentMessage = {
	id: string;
	channelId: string;
	conversationId: string;
	timestamp: Date;
};

export type ChannelCapabilities = {
	threads: boolean;
	richText: boolean;
	attachments: boolean;
	buttons: boolean;
	reactions?: boolean;
	progressUpdates?: boolean;
	inlineKeyboards?: boolean;
	typing?: boolean;
	messageEditing?: boolean;
};

export interface Channel {
	readonly id: string;
	readonly name: string;
	readonly capabilities: ChannelCapabilities;

	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(conversationId: string, message: OutboundMessage): Promise<SentMessage>;
	onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
