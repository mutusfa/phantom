import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Appends structured JSONL entries for each tool call made during a session.
 * Written to data/traces/<session-key>.jsonl so the harness proposer and
 * evolution reflection judges can grep for specific tool calls and outputs.
 */
export class TraceWriter {
	private readonly path: string;
	private dirCreated = false;

	constructor(sessionKey: string) {
		// Sanitize: replace filesystem-unsafe chars, cap length
		const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
		this.path = join(process.cwd(), "data", "traces", `${safe}.jsonl`);
	}

	logToolUse(tool: string, input: Record<string, unknown>): void {
		this.ensureDir();
		const entry = {
			type: "tool_use",
			tool,
			input,
			ts: new Date().toISOString(),
		};
		appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
	}

	getPath(): string {
		return this.path;
	}

	private ensureDir(): void {
		if (!this.dirCreated) {
			mkdirSync(dirname(this.path), { recursive: true });
			this.dirCreated = true;
		}
	}
}
