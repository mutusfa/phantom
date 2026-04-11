import { describe, expect, test } from "bun:test";
import { EvolutionConfigSchema } from "../config.ts";
import { JUDGE_MODEL_SONNET } from "../judges/types.ts";
import { type EvolvedConfig, mergeEvolvedConfigs } from "../types.ts";

const emptyConfig: EvolvedConfig = {
	constitution: "",
	persona: "",
	userProfile: "",
	domainKnowledge: "",
	strategies: { taskPatterns: "", toolPreferences: "", errorRecovery: "" },
	meta: { version: 1, metricsSnapshot: { session_count: 0, success_rate_7d: 0, correction_rate_7d: 0 } },
};

describe("EvolutionConfigSchema", () => {
	test("defaults reflection model to current Sonnet judge model", () => {
		const parsed = EvolutionConfigSchema.parse({});
		expect(parsed.reflection.model).toBe(JUDGE_MODEL_SONNET);
	});
});

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
			meta: { version: 5, metricsSnapshot: { session_count: 10, success_rate_7d: 0.9, correction_rate_7d: 0.1 } },
		};
		const project: EvolvedConfig = {
			...emptyConfig,
			meta: { version: 99, metricsSnapshot: { session_count: 0, success_rate_7d: 0, correction_rate_7d: 0 } },
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
