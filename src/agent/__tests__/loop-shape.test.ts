import { describe, expect, test } from "bun:test";
import { absorbAssistantToolPattern, applyAssistantLoopDelta, emptyLoopShapeMetrics } from "../loop-shape.ts";

describe("loop-shape", () => {
	test("counts assistant turns, Read paths, and tool calls", () => {
		const acc = emptyLoopShapeMetrics();
		const m1 = {
			message: {
				content: [
					{ type: "tool_use", name: "Read", input: { file_path: "./a.ts" } },
					{ type: "tool_use", name: "Grep", input: { pattern: "x" } },
				],
			},
		};
		applyAssistantLoopDelta(acc, absorbAssistantToolPattern(m1));
		const m2 = {
			message: {
				content: [{ type: "tool_use", name: "Read", input: { file_path: "./a.ts" } }],
			},
		};
		applyAssistantLoopDelta(acc, absorbAssistantToolPattern(m2));
		expect(acc.assistantTurns).toBe(2);
		expect(acc.toolCalls).toBe(3);
		expect(acc.uniqueReadPaths.size).toBe(1);
		expect([...acc.uniqueReadPaths]).toEqual(["./a.ts"]);
	});
});
