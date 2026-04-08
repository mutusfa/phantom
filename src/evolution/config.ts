import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { JUDGE_MODEL_SONNET } from "./judges/types.ts";

export const EvolutionConfigSchema = z.object({
	cadence: z
		.object({
			reflection_interval: z.number().int().positive().default(1),
			consolidation_interval: z.number().int().positive().default(10),
			full_review_interval: z.number().int().positive().default(50),
			drift_check_interval: z.number().int().positive().default(20),
		})
		.default({}),
	gates: z
		.object({
			drift_threshold: z.number().min(0).max(1).default(0.7),
			max_file_lines: z.number().int().positive().default(200),
			auto_rollback_threshold: z.number().min(0).max(1).default(0.1),
			auto_rollback_window: z.number().int().positive().default(5),
		})
		.default({}),
	reflection: z
		.object({
			model: z.string().default(JUDGE_MODEL_SONNET),
			effort: z.enum(["low", "medium", "high", "max"]).default("high"),
			max_budget_usd: z.number().positive().default(0.5),
		})
		.default({}),
	judges: z
		.object({
			enabled: z.enum(["auto", "always", "never"]).default("auto"),
			cost_cap_usd_per_day: z.number().positive().default(50.0),
			max_golden_suite_size: z.number().int().positive().default(50),
		})
		.default({}),
	paths: z
		.object({
			config_dir: z.string().default("phantom-config"),
			constitution: z.string().default("phantom-config/constitution.md"),
			version_file: z.string().default("phantom-config/meta/version.json"),
			metrics_file: z.string().default("phantom-config/meta/metrics.json"),
			evolution_log: z.string().default("phantom-config/meta/evolution-log.jsonl"),
			golden_suite: z.string().default("phantom-config/meta/golden-suite.jsonl"),
			session_log: z.string().default("phantom-config/memory/session-log.jsonl"),
			/** Base directory for source code deltas (relative to project root). */
			source_dir: z.string().default("src"),
			/** Base directory for Claude Code skill files (relative to project root). */
			skills_dir: z.string().default(".claude/skills"),
		})
		.default({}),
	/** Opt-in capabilities that expand what the evolution engine can modify. */
	capabilities: z
		.object({
			/** Allow the engine to modify phantom-config/ markdown files. Defaults true (existing behavior). */
			allow_config_changes: z.boolean().default(true),
			/** Allow the engine to modify files under source_dir. Requires typecheck to pass. */
			allow_source_changes: z.boolean().default(false),
			/** Allow the engine to create/modify Claude Code skill files under skills_dir. */
			allow_skill_creation: z.boolean().default(false),
			/** Allow the engine to register/unregister dynamic MCP tools via the tool registry. */
			allow_tool_registration: z.boolean().default(false),
		})
		.default({}),
});

export type EvolutionConfig = z.infer<typeof EvolutionConfigSchema>;

const DEFAULT_CONFIG_PATH = "config/evolution.yaml";

export function loadEvolutionConfig(path?: string): EvolutionConfig {
	const configPath = path ?? DEFAULT_CONFIG_PATH;

	let text: string;
	try {
		text = readFileSync(configPath, "utf-8");
	} catch {
		console.warn(`[evolution] No config at ${configPath}, using defaults`);
		return EvolutionConfigSchema.parse({});
	}

	const parsed: unknown = parse(text);
	const result = EvolutionConfigSchema.safeParse(parsed);

	if (!result.success) {
		const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
		console.warn(`[evolution] Invalid config at ${configPath}, using defaults:\n${issues}`);
		return EvolutionConfigSchema.parse({});
	}

	return result.data;
}
