import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PhantomConfig } from "../../config/types.ts";
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

describe("assemblePrompt Docker awareness", () => {
	const origDockerEnv = process.env.PHANTOM_DOCKER;

	beforeEach(() => {
		process.env.PHANTOM_DOCKER = undefined;
	});

	afterEach(() => {
		process.env.PHANTOM_DOCKER = origDockerEnv;
	});

	test("bare metal mode uses VM language", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("dedicated virtual machine");
		expect(prompt).toContain("Hostname: test-phantom");
		expect(prompt).not.toContain("Docker container");
		expect(prompt).not.toContain("Docker-specific notes");
	});

	test("Docker mode uses container language when PHANTOM_DOCKER=true", () => {
		process.env.PHANTOM_DOCKER = "true";
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Docker container");
		expect(prompt).toContain("Container: phantom");
		expect(prompt).not.toContain("dedicated virtual machine");
	});

	test("Docker mode includes Docker-specific notes", () => {
		process.env.PHANTOM_DOCKER = "true";
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Docker-specific notes:");
		expect(prompt).toContain("sibling");
		expect(prompt).toContain("ClickHouse, Postgres, Redis");
		expect(prompt).toContain("Docker volumes");
		expect(prompt).toContain("http://qdrant:6333");
		expect(prompt).toContain("http://ollama:11434");
	});

	test("Docker mode warns agent not to modify compose/Dockerfile", () => {
		process.env.PHANTOM_DOCKER = "true";
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Do NOT modify docker-compose.yaml or Dockerfile");
	});

	test("non-Docker prompt still contains core capabilities", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Full Bash access");
		expect(prompt).toContain("Docker");
		expect(prompt).toContain("phantom_register_tool");
	});

	test("Docker prompt still contains core capabilities", () => {
		process.env.PHANTOM_DOCKER = "true";
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Full Bash access");
		expect(prompt).toContain("phantom_register_tool");
		expect(prompt).toContain("Security Boundaries");
	});
});

describe("assemblePrompt project context", () => {
	test("includes project context section when provided", () => {
		const prompt = assemblePrompt(baseConfig, undefined, undefined, undefined, undefined, undefined, undefined, "You are working on receipt-models. It uses Python 3.12 and PyTorch.");
		expect(prompt).toContain("# Active Project");
		expect(prompt).toContain("receipt-models");
		expect(prompt).toContain("PyTorch");
	});

	test("omits project context section when not provided", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).not.toContain("# Active Project");
	});

	test("project context appears between evolved config and instructions", () => {
		const prompt = assemblePrompt(baseConfig, undefined, undefined, undefined, undefined, undefined, undefined, "Project context here");
		const projectIdx = prompt.indexOf("# Active Project");
		const instructionsIdx = prompt.indexOf("# How You Work");
		expect(projectIdx).toBeGreaterThan(-1);
		expect(instructionsIdx).toBeGreaterThan(projectIdx);
	});
});

describe("assemblePrompt task completion verification", () => {
	test("includes verification protocol in instructions", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Task Completion Verification");
		expect(prompt).toContain("minimum required state changes");
	});

	test("requires verifying state changes actually occurred", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("Verify those changes actually occurred");
	});

	test("includes tool registration check", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("phantom_list_dynamic_tools");
	});

	test("requires running tests before claiming code change is complete", () => {
		const prompt = assemblePrompt(baseConfig);
		expect(prompt).toContain("run the relevant tests before claiming");
	});
});
