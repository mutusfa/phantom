/**
 * Per-query loop-shape counters for comparing main-agent turns with reflection
 * drains. Counts are derived from streamed SDK assistant messages only.
 */

export type LoopShapeMetrics = {
	assistantTurns: number;
	uniqueReadPaths: Set<string>;
	toolCalls: number;
};

export function emptyLoopShapeMetrics(): LoopShapeMetrics {
	return { assistantTurns: 0, uniqueReadPaths: new Set<string>(), toolCalls: 0 };
}

function readPathFromToolInput(input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const fp = (input as { file_path?: unknown }).file_path;
	return typeof fp === "string" ? fp : null;
}

/**
 * Increment counters from one SDK `assistant` message (tool blocks included).
 */
export function absorbAssistantToolPattern(message: {
	message?: { content?: ReadonlyArray<{ type: string; name?: string; input?: unknown }> };
}): Pick<LoopShapeMetrics, "toolCalls"> & { readPaths: string[] } {
	const content = message.message?.content;
	if (!Array.isArray(content)) {
		return { toolCalls: 0, readPaths: [] };
	}
	let toolCalls = 0;
	const readPaths: string[] = [];
	for (const block of content) {
		if (block.type !== "tool_use") continue;
		toolCalls += 1;
		if (block.name === "Read") {
			const p = readPathFromToolInput(block.input);
			if (p) readPaths.push(p);
		}
	}
	return { toolCalls, readPaths };
}

export function applyAssistantLoopDelta(
	metrics: LoopShapeMetrics,
	delta: ReturnType<typeof absorbAssistantToolPattern>,
): void {
	metrics.assistantTurns += 1;
	metrics.toolCalls += delta.toolCalls;
	for (const p of delta.readPaths) {
		metrics.uniqueReadPaths.add(p);
	}
}

/** Emitted after a main-agent SDK query completes (Slack, chat, CLI, etc.). */
export type MainAgentLoopPayload = {
	sessionKey: string;
	channelId: string;
	conversationId: string;
	assistantTurns: number;
	uniqueReadPaths: number;
	toolCalls: number;
	costUsd: number;
	model: string;
	durationMs: number;
};
