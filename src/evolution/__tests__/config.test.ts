import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { EvolutionConfigSchema, loadEvolutionConfig } from "../config.ts";
import { type EvolvedConfig, mergeEvolvedConfigs } from "../types.ts";

// Phase 3 config schema tests. The old 6-judge knobs are gone; the schema
// is now just a reflection enable flag plus paths.

const TEST_DIR = "/tmp/phantom-test-config";

describe("EvolutionConfigSchema", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	test("empty object returns full defaults", () => {
		const parsed = EvolutionConfigSchema.parse({});
		expect(parsed.reflection.enabled).toBe("auto");
		expect(parsed.paths.config_dir).toBe("phantom-config");
	});

	test("reflection.enabled accepts all three modes", () => {
		for (const mode of ["auto", "always", "never"] as const) {
			const parsed = EvolutionConfigSchema.parse({ reflection: { enabled: mode } });
			expect(parsed.reflection.enabled).toBe(mode);
		}
	});

	test("reflection.enabled rejects unknown modes", () => {
		expect(() => EvolutionConfigSchema.parse({ reflection: { enabled: "sometimes" } })).toThrow();
	});

	test("custom paths override the defaults", () => {
		const parsed = EvolutionConfigSchema.parse({
			paths: {
				config_dir: "/custom/dir",
				constitution: "/custom/constitution.md",
				version_file: "/custom/meta/version.json",
				metrics_file: "/custom/meta/metrics.json",
				evolution_log: "/custom/meta/evolution-log.jsonl",
				session_log: "/custom/memory/session-log.jsonl",
			},
		});
		expect(parsed.paths.config_dir).toBe("/custom/dir");
	});
});

describe("loadEvolutionConfig", () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	test("returns defaults when file is missing", () => {
		const config = loadEvolutionConfig(`${TEST_DIR}/does-not-exist.yaml`);
		expect(config.reflection.enabled).toBe("auto");
	});

	test("reads a minimal config", () => {
		const path = `${TEST_DIR}/evolution.yaml`;
		writeFileSync(path, 'reflection:\n  enabled: "never"\n', "utf-8");
		const config = loadEvolutionConfig(path);
		expect(config.reflection.enabled).toBe("never");
	});

	test("falls back to defaults on malformed YAML", () => {
		const path = `${TEST_DIR}/evolution.yaml`;
		writeFileSync(path, "reflection:\n  enabled: 123\n", "utf-8");
		const config = loadEvolutionConfig(path);
		// Malformed field type is caught by zod and the function returns
		// defaults.
		expect(config.reflection.enabled).toBe("auto");
	});

	test("accepts the full production YAML shape", () => {
		const path = `${TEST_DIR}/evolution.yaml`;
		writeFileSync(
			path,
			[
				"reflection:",
				'  enabled: "auto"',
				"paths:",
				'  config_dir: "phantom-config"',
				'  constitution: "phantom-config/constitution.md"',
				'  version_file: "phantom-config/meta/version.json"',
				'  metrics_file: "phantom-config/meta/metrics.json"',
				'  evolution_log: "phantom-config/meta/evolution-log.jsonl"',
				'  session_log: "phantom-config/memory/session-log.jsonl"',
			].join("\n"),
			"utf-8",
		);
		const config = loadEvolutionConfig(path);
		expect(config.reflection.enabled).toBe("auto");
	});
});


const emptyConfig: EvolvedConfig = {
	constitution: "",
	persona: "",
	userProfile: "",
	domainKnowledge: "",
	strategies: { taskPatterns: "", toolPreferences: "", errorRecovery: "" },
	meta: { version: 0, metricsSnapshot: { session_count: 0, success_rate_7d: 0 } },
};

describe("mergeEvolvedConfigs", () => {
	test("returns global config when project config is empty", () => {
		const global: EvolvedConfig = { ...emptyConfig, domainKnowledge: "Global knowledge" };
		const merged = mergeEvolvedConfigs(global, emptyConfig);
		expect(merged.domainKnowledge).toBe("Global knowledge");
	});

	test("appends project domain knowledge to global", () => {
		const global: EvolvedConfig = { ...emptyConfig, domainKnowledge: "Global stuff" };
		const project: EvolvedConfig = { ...emptyConfig, domainKnowledge: "Project-specific stuff" };
		const merged = mergeEvolvedConfigs(global, project);
		expect(merged.domainKnowledge).toContain("Global stuff");
		expect(merged.domainKnowledge).toContain("Project-specific stuff");
	});

	test("never overrides constitution from project", () => {
		const global: EvolvedConfig = { ...emptyConfig, constitution: "Never do X" };
		const project: EvolvedConfig = { ...emptyConfig, constitution: "Do X sometimes" };
		const merged = mergeEvolvedConfigs(global, project);
		expect(merged.constitution).toBe("Never do X");
	});

	test("appends project strategies to global strategies", () => {
		const global: EvolvedConfig = {
			...emptyConfig,
			strategies: { ...emptyConfig.strategies, taskPatterns: "Global pattern" },
		};
		const project: EvolvedConfig = {
			...emptyConfig,
			strategies: { ...emptyConfig.strategies, taskPatterns: "Project pattern" },
		};
		const merged = mergeEvolvedConfigs(global, project);
		expect(merged.strategies.taskPatterns).toContain("Global pattern");
		expect(merged.strategies.taskPatterns).toContain("Project pattern");
	});

	test("uses global meta, not project meta", () => {
		const global: EvolvedConfig = {
			...emptyConfig,
			meta: { version: 5, metricsSnapshot: { session_count: 10, success_rate_7d: 0.9 } },
		};
		const project: EvolvedConfig = {
			...emptyConfig,
			meta: { version: 99, metricsSnapshot: { session_count: 0, success_rate_7d: 0 } },
		};
		const merged = mergeEvolvedConfigs(global, project);
		expect(merged.meta.version).toBe(5);
	});

	test("project-only fields work when global is empty", () => {
		const project: EvolvedConfig = { ...emptyConfig, persona: "Friendly DS helper" };
		const merged = mergeEvolvedConfigs(emptyConfig, project);
		expect(merged.persona).toBe("Friendly DS helper");
	});
});
