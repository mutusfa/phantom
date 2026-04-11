import { join } from "node:path";
import type { EvolutionConfig } from "./config.ts";

/**
 * Build evolution path config for a project-specific evolved tree under an absolute directory.
 * Keeps global constitution and source/skills paths so gates and code deltas still resolve correctly.
 * Version, metrics, golden suite, session log, and config file writes go under the project root.
 */
export function deriveProjectEvolutionConfig(
	base: EvolutionConfig,
	projectEvolvedDirAbsolute: string,
): EvolutionConfig {
	const root = projectEvolvedDirAbsolute;
	return {
		...base,
		paths: {
			...base.paths,
			config_dir: root,
			version_file: join(root, "meta", "version.json"),
			metrics_file: join(root, "meta", "metrics.json"),
			evolution_log: join(root, "meta", "evolution-log.jsonl"),
			golden_suite: join(root, "meta", "golden-suite.jsonl"),
			session_log: join(root, "memory", "session-log.jsonl"),
		},
	};
}
