import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TraceWriter } from "../trace-writer.ts";

const TRACES_DIR = join(process.cwd(), "data", "traces");

function cleanTraceFile(sessionKey: string): void {
	const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
	const path = join(TRACES_DIR, `${safe}.jsonl`);
	if (existsSync(path)) rmSync(path);
}

describe("TraceWriter", () => {
	const testKey = "test-trace-writer-unit";

	afterEach(() => {
		cleanTraceFile(testKey);
	});

	test("getPath returns a .jsonl file path under data/traces/", () => {
		const tw = new TraceWriter(testKey);
		expect(tw.getPath()).toContain("data/traces/");
		expect(tw.getPath()).toEndWith(".jsonl");
	});

	test("logToolUse creates the file and writes a JSONL entry", () => {
		const tw = new TraceWriter(testKey);
		tw.logToolUse("Bash", { command: "ls" });

		const path = tw.getPath();
		expect(existsSync(path)).toBeTrue();

		const lines = readFileSync(path, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(1);

		const entry = JSON.parse(lines[0] as string);
		expect(entry.type).toBe("tool_use");
		expect(entry.tool).toBe("Bash");
		expect(entry.input).toEqual({ command: "ls" });
		expect(entry.ts).toBeDefined();
	});

	test("multiple logToolUse calls append separate JSONL lines", () => {
		const tw = new TraceWriter(testKey);
		tw.logToolUse("Read", { file_path: "/tmp/a.txt" });
		tw.logToolUse("Edit", { file_path: "/tmp/a.txt", old_string: "x", new_string: "y" });
		tw.logToolUse("Bash", { command: "echo done" });

		const lines = readFileSync(tw.getPath(), "utf-8").trim().split("\n");
		expect(lines).toHaveLength(3);

		const tools = lines.map((l) => JSON.parse(l as string).tool);
		expect(tools).toEqual(["Read", "Edit", "Bash"]);
	});

	test("sanitizes unsafe characters in session key", () => {
		const tw = new TraceWriter("my/session:with unsafe chars!");
		// Should not throw when logging
		tw.logToolUse("Bash", { command: "test" });
		expect(existsSync(tw.getPath())).toBeTrue();
		cleanTraceFile("my/session:with unsafe chars!");
	});

	test("caps session key at 120 characters in file path", () => {
		const longKey = "a".repeat(200);
		const tw = new TraceWriter(longKey);
		const filename = tw.getPath().split("/").pop() ?? "";
		// filename = <safe>.jsonl, safe is max 120 chars
		expect(filename.replace(".jsonl", "").length).toBeLessThanOrEqual(120);
		cleanTraceFile(longKey);
	});

	test("getPath returns same path on repeated calls", () => {
		const tw = new TraceWriter(testKey);
		expect(tw.getPath()).toBe(tw.getPath());
	});
});
