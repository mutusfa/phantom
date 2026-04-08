import { randomUUID } from "node:crypto";
import { App, type LogLevel } from "@slack/bolt";
import type { SlackBlock } from "./feedback.ts";
import { buildFeedbackBlocks } from "./feedback.ts";
import { registerSlackActions } from "./slack-actions.ts";
import { splitMessage, toSlackMarkdown, truncateForSlack } from "./slack-formatter.ts";
import type { Channel, ChannelCapabilities, InboundMessage, OutboundMessage, SentMessage } from "./types.ts";

export type SlackChannelConfig = {
	botToken: string;
	appToken: string;
	defaultChannelId?: string;
	ownerUserId?: string;
};

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

type ReactionHandler = (event: {
	reaction: string;
	userId: string;
	messageTs: string;
	channel: string;
	isPositive: boolean;
}) => void;

export class SlackChannel implements Channel {
	readonly id = "slack";
	readonly name = "Slack";
	readonly capabilities: ChannelCapabilities = {
		threads: true,
		richText: true,
		attachments: true,
		buttons: true,
		reactions: true,
		progressUpdates: true,
	};

	private app: App;
	private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
	private reactionHandler: ReactionHandler | null = null;
	private connectionState: ConnectionState = "disconnected";
	private botUserId: string | null = null;
	private ownerUserId: string | null;
	private phantomName: string;
	private rejectedUsers = new Set<string>();
	private botToken: string;

	constructor(config: SlackChannelConfig) {
		this.app = new App({
			token: config.botToken,
			socketMode: true,
			appToken: config.appToken,
			logLevel: "ERROR" as LogLevel,
		});
		this.botToken = config.botToken;
		this.ownerUserId = config.ownerUserId ?? null;
		this.phantomName = "Phantom";
	}

	// Downloads text-based files attached to a Slack message and returns formatted content.
	// Only fetches files under 200KB with text mimetypes to avoid overwhelming the context.
	private async fetchSlackFiles(files: unknown[]): Promise<string> {
		const TEXT_MIMETYPES = ["text/", "application/json", "application/xml", "application/yaml"];
		const MAX_SIZE = 200 * 1024;
		const parts: string[] = [];

		for (const file of files) {
			const f = file as Record<string, unknown>;
			const name = (f.name as string) ?? "file";
			const mimetype = (f.mimetype as string) ?? "";
			const size = (f.size as number) ?? 0;
			const url = (f.url_private_download as string) ?? (f.url_private as string) ?? "";

			if (!url) continue;
			if (size > MAX_SIZE) {
				parts.push(`[File "${name}" skipped - too large (${Math.round(size / 1024)}KB)]`);
				continue;
			}
			if (!TEXT_MIMETYPES.some((t) => mimetype.startsWith(t))) {
				parts.push(`[File "${name}" skipped - binary format (${mimetype})]`);
				continue;
			}

			try {
				const res = await fetch(url, { headers: { Authorization: `Bearer ${this.botToken}` } });
				if (!res.ok) {
					parts.push(`[File "${name}" could not be downloaded: HTTP ${res.status}]`);
					continue;
				}
				const content = await res.text();
				parts.push(`--- Attached file: ${name} ---\n${content}\n--- End of ${name} ---`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				parts.push(`[File "${name}" download failed: ${msg}]`);
			}
		}

		return parts.join("\n\n");
	}

	setPhantomName(name: string): void {
		this.phantomName = name;
	}

	getOwnerUserId(): string | null {
		return this.ownerUserId;
	}

	/** Expose the Slack client for profile API calls */
	getClient(): App["client"] {
		return this.app.client;
	}

	private isOwner(userId: string): boolean {
		if (!this.ownerUserId) return true;
		return userId === this.ownerUserId;
	}

	private async rejectNonOwner(userId: string): Promise<void> {
		// Only send the rejection once per user to avoid spam
		if (this.rejectedUsers.has(userId)) return;
		this.rejectedUsers.add(userId);

		try {
			const openResult = await this.app.client.conversations.open({ users: userId });
			const dmChannelId = openResult.channel?.id;
			if (dmChannelId) {
				await this.app.client.chat.postMessage({
					channel: dmChannelId,
					text: `Hey! I'm ${this.phantomName}, a personal AI co-worker. I can only respond to my owner. If you need your own, check out github.com/ghostwright/phantom.`,
				});
			}
		} catch {
			// Best effort - don't fail if we can't DM them
		}
	}

	async connect(): Promise<void> {
		if (this.connectionState === "connected") return;
		this.connectionState = "connecting";

		this.registerEventHandlers();
		registerSlackActions(this.app);

		try {
			await this.app.start();
			this.connectionState = "connected";

			try {
				const authResult = await this.app.client.auth.test();
				this.botUserId = authResult.user_id ?? null;
				console.log(`[slack] Connected as <@${this.botUserId}>`);
			} catch {
				console.warn("[slack] Could not resolve bot user ID. Self-message filtering may not work.");
			}

			console.log("[slack] Socket Mode connected");
		} catch (err: unknown) {
			this.connectionState = "error";
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[slack] Failed to connect: ${msg}`);
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		if (this.connectionState === "disconnected") return;

		try {
			await this.app.stop();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[slack] Error during disconnect: ${msg}`);
		}

		this.connectionState = "disconnected";
		console.log("[slack] Disconnected");
	}

	async send(conversationId: string, message: OutboundMessage): Promise<SentMessage> {
		const { channel, threadTs } = parseConversationId(conversationId);
		const formattedText = toSlackMarkdown(message.text);
		const replyThreadTs = message.threadId ?? threadTs;
		const chunks = splitMessage(formattedText);
		let lastTs = "";

		for (const chunk of chunks) {
			const result = await this.app.client.chat.postMessage({
				channel,
				text: chunk,
				thread_ts: replyThreadTs,
			});
			lastTs = result.ts ?? "";
		}

		return {
			id: lastTs || randomUUID(),
			channelId: this.id,
			conversationId,
			timestamp: new Date(),
		};
	}

	onMessage(handler: (message: InboundMessage) => Promise<void>): void {
		this.messageHandler = handler;
	}

	onReaction(handler: ReactionHandler): void {
		this.reactionHandler = handler;
	}

	isConnected(): boolean {
		return this.connectionState === "connected";
	}

	getConnectionState(): ConnectionState {
		return this.connectionState;
	}

	async postToChannel(channelId: string, text: string): Promise<string | null> {
		const formattedText = toSlackMarkdown(text);
		const chunks = splitMessage(formattedText);
		let lastTs: string | null = null;

		for (const chunk of chunks) {
			try {
				const result = await this.app.client.chat.postMessage({
					channel: channelId,
					text: chunk,
				});
				lastTs = result.ts ?? null;
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[slack] Failed to post to channel ${channelId}: ${msg}`);
				return null;
			}
		}

		return lastTs;
	}

	async sendDm(userId: string, text: string): Promise<string | null> {
		try {
			const openResult = await this.app.client.conversations.open({ users: userId });
			const dmChannelId = openResult.channel?.id;
			if (!dmChannelId) {
				console.error(`[slack] Failed to open DM with user ${userId}: no channel returned`);
				return null;
			}
			return this.postToChannel(dmChannelId, text);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[slack] Failed to send DM to user ${userId}: ${msg}`);
			return null;
		}
	}

	// Fetches prior messages in a thread so a fresh session can see what came before.
	// Excludes the current message (currentTs) to avoid duplicating it in context.
	async fetchThreadHistory(channel: string, threadTs: string, currentTs: string): Promise<string> {
		try {
			const result = await this.app.client.conversations.replies({
				channel,
				ts: threadTs,
				limit: 20,
			});
			const messages = (result.messages ?? []) as Array<{
				bot_id?: string;
				user?: string;
				text?: string;
				ts?: string;
			}>;

			const prior = messages.filter((m) => m.ts !== currentTs && m.text?.trim());
			if (prior.length === 0) return "";

			const lines = prior.map((m) => {
				const isBot = m.bot_id != null || m.user === this.botUserId;
				const speaker = isBot ? "Phantom" : "User";
				const text = (m.text ?? "").slice(0, 800);
				return `${speaker}: ${text}`;
			});

			return `[Prior messages in this thread]\n${lines.join("\n")}\n`;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[slack] Failed to fetch thread history: ${msg}`);
			return "";
		}
	}

	async postThinking(channel: string, threadTs: string): Promise<string | null> {
		try {
			const result = await this.app.client.chat.postMessage({
				channel,
				thread_ts: threadTs,
				text: "Working on it...",
			});
			return result.ts ?? null;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[slack] Failed to post thinking indicator: ${msg}`);
			return null;
		}
	}

	async updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlock[]): Promise<void> {
		const formattedText = toSlackMarkdown(text);
		const truncated = truncateForSlack(formattedText);

		try {
			const updateArgs: Record<string, unknown> = { channel, ts, text: truncated };
			if (blocks) updateArgs.blocks = blocks;
			await this.app.client.chat.update(updateArgs as unknown as Parameters<typeof this.app.client.chat.update>[0]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[slack] Failed to update message: ${msg}`);
		}
	}

	/** Update a message with text + feedback buttons appended */
	async updateWithFeedback(channel: string, ts: string, text: string): Promise<void> {
		const formattedText = toSlackMarkdown(text);
		const truncated = truncateForSlack(formattedText);
		const feedbackBlocks = buildFeedbackBlocks(ts);

		const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: truncated } }, ...feedbackBlocks];

		try {
			const updateArgs: Record<string, unknown> = { channel, ts, text: truncated, blocks };
			await this.app.client.chat.update(updateArgs as unknown as Parameters<typeof this.app.client.chat.update>[0]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[slack] Failed to update message with feedback: ${msg}`);
		}
	}

	async addReaction(channel: string, messageTs: string, emoji: string): Promise<void> {
		try {
			await this.app.client.reactions.add({ channel, timestamp: messageTs, name: emoji });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// "already_reacted" is not a real error
			if (!msg.includes("already_reacted")) {
				console.warn(`[slack] Failed to add reaction :${emoji}:: ${msg}`);
			}
		}
	}

	async removeReaction(channel: string, messageTs: string, emoji: string): Promise<void> {
		try {
			await this.app.client.reactions.remove({ channel, timestamp: messageTs, name: emoji });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// "no_reaction" is expected when the reaction was already removed
			if (!msg.includes("no_reaction")) {
				console.warn(`[slack] Failed to remove reaction :${emoji}:: ${msg}`);
			}
		}
	}

	private registerEventHandlers(): void {
		this.app.event("app_mention", async ({ event, client: _client }) => {
			if (!this.messageHandler) return;

			const senderId = event.user ?? "unknown";
			if (!this.isOwner(senderId)) {
				console.log(`[slack] Ignoring app_mention from non-owner: ${senderId}`);
				await this.rejectNonOwner(senderId);
				return;
			}

			const cleanText = this.stripBotMention(event.text);
			const ev = event as unknown as Record<string, unknown>;
			const files = Array.isArray(ev.files) ? ev.files : [];
			const fileContent = files.length > 0 ? await this.fetchSlackFiles(files) : "";
			const fullText = [cleanText.trim(), fileContent].filter(Boolean).join("\n\n");
			if (!fullText) return;

			const threadTs = event.thread_ts ?? event.ts;
			const conversationId = buildConversationId(event.channel, threadTs);

			const inbound: InboundMessage = {
				id: event.ts,
				channelId: this.id,
				conversationId,
				threadId: threadTs,
				senderId,
				text: fullText,
				timestamp: new Date(Number.parseFloat(event.ts) * 1000),
				metadata: {
					slackChannel: event.channel,
					slackThreadTs: threadTs,
					slackMessageTs: event.ts,
					source: "app_mention",
				},
			};

			try {
				await this.messageHandler(inbound);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[slack] Error handling app_mention: ${msg}`);
			}
		});

		this.app.event("message", async ({ event }) => {
			if (!this.messageHandler) return;

			const msg = event as unknown as Record<string, unknown>;
			if (msg.subtype) return;
			if (msg.bot_id) return;

			const userId = msg.user as string | undefined;
			if (this.botUserId && userId === this.botUserId) return;

			const channelType = msg.channel_type as string | undefined;
			if (channelType !== "im") return;

			if (userId && !this.isOwner(userId)) {
				console.log(`[slack] Ignoring DM from non-owner: ${userId}`);
				await this.rejectNonOwner(userId);
				return;
			}

			const text = (msg.text as string) ?? "";
			const files = Array.isArray(msg.files) ? (msg.files as unknown[]) : [];
			const fileContent = files.length > 0 ? await this.fetchSlackFiles(files) : "";
			const fullText = [text.trim(), fileContent].filter(Boolean).join("\n\n");
			if (!fullText) return;

			const channel = msg.channel as string;
			const ts = msg.ts as string;
			const threadTs = (msg.thread_ts as string) ?? ts;
			// DMs use the same thread-scoped session boundary as channels.
			// Each thread (or top-level message) gets its own session.
			// Cross-session continuity comes from Qdrant memory, not session resume.
			const conversationId = buildConversationId(channel, threadTs);

			const inbound: InboundMessage = {
				id: ts,
				channelId: this.id,
				conversationId,
				threadId: threadTs,
				senderId: userId ?? "unknown",
				text: fullText,
				timestamp: new Date(Number.parseFloat(ts) * 1000),
				metadata: {
					slackChannel: channel,
					slackThreadTs: threadTs,
					slackMessageTs: ts,
					source: "dm",
				},
			};

			try {
				await this.messageHandler(inbound);
			} catch (err: unknown) {
				const errMsg = err instanceof Error ? err.message : String(err);
				console.error(`[slack] Error handling DM: ${errMsg}`);
			}
		});

		this.app.event("reaction_added", async ({ event }) => {
			const reaction = event.reaction;
			const isPositive =
				reaction === "+1" || reaction === "thumbsup" || reaction === "heart" || reaction === "white_check_mark";
			const isNegative = reaction === "-1" || reaction === "thumbsdown" || reaction === "x";

			if (!isPositive && !isNegative) return;

			console.log(`[slack] Reaction ${isPositive ? "positive" : "negative"}: :${reaction}: from ${event.user}`);

			if (this.reactionHandler) {
				this.reactionHandler({
					reaction,
					userId: event.user,
					messageTs: event.item.ts,
					channel: event.item.channel,
					isPositive,
				});
			}
		});
	}

	private stripBotMention(text: string): string {
		if (this.botUserId) {
			return text.replace(new RegExp(`<@${this.botUserId}>\\s*`, "g"), "");
		}
		return text.replace(/^<@[A-Z0-9]+>\s*/, "");
	}
}

function buildConversationId(channel: string, threadTs: string): string {
	return `slack:${channel}:${threadTs}`;
}

function parseConversationId(conversationId: string): { channel: string; threadTs: string | undefined } {
	const parts = conversationId.split(":");
	if (parts[1] === "dm") {
		return { channel: parts[2], threadTs: undefined };
	}
	return { channel: parts[1], threadTs: parts[2] };
}
