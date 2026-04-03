/**
 * Azure DevOps service hook handler for PR comment events.
 * Configured via ADO_WEBHOOK_USERNAME + ADO_WEBHOOK_PASSWORD env vars.
 * ADO sends Basic auth credentials when delivering service hooks.
 */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type AdoWebhookConfig = {
	username: string;
	password: string;
};

export type AdoPrCommentEvent = {
	prId: number;
	prTitle: string;
	repo: string;
	project: string;
	author: string;
	comment: string;
};

const AdoServiceHookPayloadSchema = z.object({
	eventType: z.string(),
	resource: z.object({
		comment: z
			.object({
				id: z.number(),
				content: z.string(),
				author: z.object({
					displayName: z.string(),
					uniqueName: z.string().optional(),
				}),
			})
			.optional(),
		pullRequest: z
			.object({
				pullRequestId: z.number(),
				title: z.string(),
				repository: z.object({
					name: z.string(),
					project: z.object({
						name: z.string(),
					}),
				}),
			})
			.optional(),
	}),
});

export class AdoWebhookHandler {
	private config: AdoWebhookConfig;
	private eventHandler: ((event: AdoPrCommentEvent) => Promise<void>) | null = null;

	constructor(config: AdoWebhookConfig) {
		this.config = config;
	}

	onEvent(handler: (event: AdoPrCommentEvent) => Promise<void>): void {
		this.eventHandler = handler;
	}

	async handleRequest(req: Request): Promise<Response> {
		if (req.method !== "POST") {
			return Response.json({ error: "Method not allowed" }, { status: 405 });
		}

		if (!this.verifyAuth(req)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		let raw: unknown;
		try {
			raw = await req.json();
		} catch {
			return Response.json({ error: "Invalid JSON" }, { status: 400 });
		}

		const parsed = AdoServiceHookPayloadSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json({ error: "Invalid payload", details: parsed.error.message }, { status: 400 });
		}

		const payload = parsed.data;

		// Acknowledge but ignore non-comment events (ADO may send other event types)
		if (payload.eventType !== "ms.vss-code.git-pullrequest-comment-event") {
			console.log(`[ado-webhook] Ignoring event type: ${payload.eventType}`);
			return Response.json({ status: "ignored", eventType: payload.eventType });
		}

		const { comment, pullRequest } = payload.resource;
		if (!comment || !pullRequest) {
			return Response.json({ error: "Missing comment or pullRequest in payload" }, { status: 400 });
		}

		const event: AdoPrCommentEvent = {
			prId: pullRequest.pullRequestId,
			prTitle: pullRequest.title,
			repo: pullRequest.repository.name,
			project: pullRequest.repository.project.name,
			author: comment.author.displayName,
			comment: comment.content,
		};

		console.log(`[ado-webhook] PR #${event.prId} comment from ${event.author}: "${event.comment.slice(0, 80)}..."`);

		if (this.eventHandler) {
			// Fire and forget - ADO expects a fast 200 response
			void this.eventHandler(event).catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ado-webhook] Error handling event: ${msg}`);
			});
		}

		return Response.json({ status: "accepted" });
	}

	private verifyAuth(req: Request): boolean {
		const authHeader = req.headers.get("Authorization");
		if (!authHeader?.startsWith("Basic ")) return false;

		let decoded: string;
		try {
			decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
		} catch {
			return false;
		}

		const expected = `${this.config.username}:${this.config.password}`;
		try {
			// timingSafeEqual requires equal-length buffers; throws if lengths differ
			return timingSafeEqual(Buffer.from(decoded), Buffer.from(expected));
		} catch {
			return false;
		}
	}
}
