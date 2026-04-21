import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MainAgentLoopPayload } from "./loop-shape.ts";

const RELATIVE_LOG_PATH = join("data", "main-agent-loop-shape.jsonl");

export function defaultMainAgentLoopShapeLogPath(): string {
	return join(process.cwd(), RELATIVE_LOG_PATH);
}

/**
 * Append one JSON line for offline analysis of main-agent turn counts and recall.
 * Creates `data/` (and any missing parents) relative to cwd when needed.
 */
export function appendMainAgentLoopShapeRecord(payload: MainAgentLoopPayload, filePath?: string): void {
	const path = filePath ?? defaultMainAgentLoopShapeLogPath();
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf-8");
}
