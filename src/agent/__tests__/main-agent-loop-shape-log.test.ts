import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { appendMainAgentLoopShapeRecord } from "../main-agent-loop-shape-log.ts";

describe("appendMainAgentLoopShapeRecord", () => {
	test("creates parent dir and appends one JSON line", () => {
		const dir = mkdtempSync(join(tmpdir(), "phantom-loop-shape-"));
		const logPath = join(dir, "nested", "main-agent-loop-shape.jsonl");
		appendMainAgentLoopShapeRecord(
			{
				sessionKey: "slack:th-1",
				channelId: "slack",
				conversationId: "th-1",
				assistantTurns: 3,
				uniqueReadPaths: 2,
				toolCalls: 5,
				costUsd: 0.01,
				model: "claude-sonnet",
				durationMs: 1200,
				userMessagePreview: "hello",
				recalledEpisodeIds: ["e1"],
				recalledFactIds: ["f1", "f2"],
				recalledTokenEstimate: 42,
			},
			logPath,
		);
		const raw = readFileSync(logPath, "utf-8").trimEnd();
		const lines = raw.split("\n");
		expect(lines.length).toBe(1);
		const row = JSON.parse(lines[0]!) as Record<string, unknown>;
		expect(row.sessionKey).toBe("slack:th-1");
		expect(row.recalledFactIds).toEqual(["f1", "f2"]);
		expect(row.recalledTokenEstimate).toBe(42);
		rmSync(dir, { recursive: true });
	});
});
