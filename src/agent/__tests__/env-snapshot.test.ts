import { describe, expect, test } from "bun:test";
import type { PhantomConfig } from "../../config/types.ts";
import { type EnvSnapshot, formatEnvSnapshot } from "../env-snapshot.ts";
import { assemblePrompt } from "../prompt-assembler.ts";

const baseConfig: PhantomConfig = {
	name: "test-phantom",
	port: 3100,
	role: "swe",
	model: "claude-opus-4-6",
	effort: "max",
	max_budget_usd: 0,
	timeout_minutes: 240,
};

function makeSnapshot(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
	return {
		timestamp: "2026-04-04T12:00:00.000Z",
		availableTools: ["bun", "git", "docker", "gh"],
		unavailableTools: ["jq"],
		dockerReady: true,
		freeMemoryMb: 1024,
		...overrides,
	};
}

describe("formatEnvSnapshot", () => {
	test("includes available tools", () => {
		const formatted = formatEnvSnapshot(makeSnapshot());
		expect(formatted).toContain("bun, git, docker, gh");
	});

	test("includes unavailable tools", () => {
		const formatted = formatEnvSnapshot(makeSnapshot());
		expect(formatted).toContain("jq");
		expect(formatted).toContain("Not available");
	});

	test("shows docker ready status", () => {
		expect(formatEnvSnapshot(makeSnapshot({ dockerReady: true }))).toContain("Docker: ready");
		expect(formatEnvSnapshot(makeSnapshot({ dockerReady: false }))).toContain("Docker: not available");
	});

	test("includes free memory when non-zero", () => {
		const formatted = formatEnvSnapshot(makeSnapshot({ freeMemoryMb: 2048 }));
		expect(formatted).toContain("2048MB");
	});

	test("omits free memory line when zero", () => {
		const formatted = formatEnvSnapshot(makeSnapshot({ freeMemoryMb: 0 }));
		expect(formatted).not.toContain("Free memory");
	});

	test("includes capture timestamp", () => {
		const formatted = formatEnvSnapshot(makeSnapshot());
		expect(formatted).toContain("2026-04-04T12:00:00.000Z");
	});

	test("omits unavailable tools section when all tools found", () => {
		const formatted = formatEnvSnapshot(makeSnapshot({ unavailableTools: [] }));
		expect(formatted).not.toContain("Not available");
	});
});

describe("assemblePrompt with envSnapshot", () => {
	test("includes env snapshot when provided", () => {
		const snapshot = formatEnvSnapshot(makeSnapshot());
		const prompt = assemblePrompt(
			baseConfig,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			snapshot,
		);
		expect(prompt).toContain("Current Session State");
		expect(prompt).toContain("bun, git, docker, gh");
	});

	test("works without env snapshot", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).not.toContain("Current Session State");
		expect(prompt).toContain("dedicated virtual machine");
	});

	test("env snapshot appears after environment section and before security section", () => {
		const snapshot = formatEnvSnapshot(makeSnapshot());
		const prompt = assemblePrompt(
			baseConfig,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			snapshot,
		);
		const envPos = prompt.indexOf("Your Environment");
		const snapshotPos = prompt.indexOf("Current Session State");
		const securityPos = prompt.indexOf("Security Boundaries");
		expect(snapshotPos).toBeGreaterThan(envPos);
		expect(snapshotPos).toBeLessThan(securityPos);
	});
});
