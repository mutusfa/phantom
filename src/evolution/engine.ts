import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ToolRegistryAdapter, applyApproved } from "./application.ts";
import { type EvolutionConfig, loadEvolutionConfig } from "./config.ts";
import { recordObservations, runConsolidation } from "./consolidation.ts";
import { ConstitutionChecker } from "./constitution.ts";
import { addCase, loadSuite, pruneSuite } from "./golden-suite.ts";
import { isJudgeAvailable } from "./judges/client.ts";
import { runQualityJudge } from "./judges/quality-judge.ts";
import { type JudgeCosts, emptyJudgeCosts } from "./judges/types.ts";
import {
	checkForAutoRollback,
	getMetricsSnapshot,
	readMetrics,
	resetConsolidationCounter,
	resetReflectionCounter,
	updateAfterEvolution,
	updateAfterRollback,
	updateAfterSession,
} from "./metrics.ts";
import { deriveProjectEvolutionConfig } from "./project-evolution-config.ts";
import {
	buildCritiqueFromObservations,
	extractObservations,
	extractObservationsWithLLM,
	generateDeltas,
} from "./reflection.ts";
import {
	type EvolutionResult,
	type EvolutionVersion,
	type EvolvedConfig,
	type GoldenCase,
	type SessionSummary,
	mergeEvolvedConfigs,
} from "./types.ts";
import { validateAll, validateAllWithJudges } from "./validation.ts";
import { getHistory, readVersion, rollback as versionRollbackFn } from "./versioning.ts";

export class EvolutionEngine {
	private config: EvolutionConfig;
	private checker: ConstitutionChecker;
	private llmJudgesEnabled: boolean;
	private dailyCostUsd = 0;
	private dailyCostResetDate = "";
	private toolRegistry?: ToolRegistryAdapter;

	constructor(configPath?: string) {
		this.config = loadEvolutionConfig(configPath);
		this.checker = new ConstitutionChecker(this.config);
		this.llmJudgesEnabled = this.resolveJudgeMode();
		if (this.llmJudgesEnabled) {
			console.log("[evolution] LLM judges enabled (API key detected)");
		} else {
			console.log("[evolution] LLM judges disabled (no API key or config override)");
		}
	}

	private resolveJudgeMode(): boolean {
		const setting = this.config.judges?.enabled ?? "auto";
		if (setting === "never") return false;
		if (setting === "always") return true;
		return isJudgeAvailable();
	}

	usesLLMJudges(): boolean {
		return this.llmJudgesEnabled;
	}

	/** Wire in the dynamic tool registry so evolution can register/unregister tools. */
	setToolRegistry(registry: ToolRegistryAdapter): void {
		this.toolRegistry = registry;
	}

	/** Memory consolidation runs outside afterSession() but still needs to respect the daily cap. */
	isWithinCostCap(): boolean {
		return !this.isDailyCostCapReached();
	}

	/** Consolidation judge costs happen outside the evolution pipeline but count toward the daily cap. */
	trackExternalJudgeCost(cost: { totalUsd: number }): void {
		this.resetDailyCostIfNewDay();
		this.dailyCostUsd += cost.totalUsd;
	}

	getEvolutionConfig(): EvolutionConfig {
		return this.config;
	}

	/**
	 * Main entry point: run the full 6-step evolution pipeline after a session.
	 * When useLLMJudges is true, uses Sonnet-powered judges for observation
	 * extraction, safety gate, constitution gate, regression gate, and quality
	 * assessment. Falls back to heuristics on LLM failure.
	 */
	async afterSession(session: SessionSummary): Promise<EvolutionResult> {
		const startTime = Date.now();
		const judgeCosts = emptyJudgeCosts();
		const evoConfig: EvolutionConfig = session.project_evolution_config_dir
			? deriveProjectEvolutionConfig(this.config, session.project_evolution_config_dir)
			: this.config;
		const mergedForReflection =
			session.project_evolution_config_dir != null && session.project_evolution_config_dir.length > 0
				? mergeEvolvedConfigs(this.getConfig(), this.getProjectConfig(session.project_evolution_config_dir))
				: this.getConfig();

		// Cadence check: skip the reflection pipeline until reflection_interval sessions have passed.
		// Read pre-update metrics so the check runs before updateAfterSession increments the counter.
		const preMetrics = readMetrics(evoConfig);
		const interval = evoConfig.cadence.reflection_interval;
		const cadenceSkips = !session.bypass_cadence && (preMetrics.sessions_since_reflection ?? 0) < interval - 1;
		if (cadenceSkips) {
			updateAfterSession(evoConfig, session.outcome, false);
			return { version: readVersion(evoConfig).version, changes_applied: [], changes_rejected: [] };
		}

		// Step 1: Observation Extraction (LLM or heuristic)
		let observations: import("./types.ts").SessionObservation[];
		if (this.llmJudgesEnabled && !this.isDailyCostCapReached()) {
			const result = await extractObservationsWithLLM(session, mergedForReflection, evoConfig.reflection.model);
			observations = result.observations;
			if (result.judgeCost) {
				addCost(judgeCosts.observation_extraction, result.judgeCost);
				this.incrementDailyCost(result.judgeCost.totalUsd);
			}
		} else {
			observations = extractObservations(session);
		}

		// Step 0: Update session metrics (after extraction so hadCorrections uses observation results)
		const hadCorrections = observations.some((o) => o.type === "correction");
		updateAfterSession(evoConfig, session.outcome, hadCorrections);
		// Reset reflection counter after updateAfterSession so the next cycle is a full interval.
		resetReflectionCounter(evoConfig);

		if (observations.length === 0) {
			return { version: readVersion(evoConfig).version, changes_applied: [], changes_rejected: [] };
		}

		// Record observations for later consolidation
		recordObservations(evoConfig, session.session_id, observations);

		// Step 2: Self-Critique (uses observations to build critique)
		const critique = buildCritiqueFromObservations(observations, session, mergedForReflection);

		// Step 3: Config Delta Generation
		const deltas = generateDeltas(critique, session.session_id);
		if (deltas.length === 0) {
			return { version: readVersion(evoConfig).version, changes_applied: [], changes_rejected: [] };
		}

		// Step 4: 5-Gate Validation (LLM or heuristic)
		const goldenSuite = loadSuite(evoConfig);
		let validationResults: import("./types.ts").ValidationResult[];

		if (this.llmJudgesEnabled && !this.isDailyCostCapReached()) {
			const judgeResult = await validateAllWithJudges(
				deltas,
				this.checker,
				goldenSuite,
				evoConfig,
				mergedForReflection,
			);
			validationResults = judgeResult.results;
			mergeCosts(judgeCosts, judgeResult.judgeCosts);
			this.incrementDailyCost(totalCostFromJudgeCosts(judgeResult.judgeCosts));
		} else {
			validationResults = validateAll(deltas, this.checker, goldenSuite, evoConfig);
		}

		// Step 5: Application
		const metricsSnapshot = getMetricsSnapshot(evoConfig);
		const { applied, rejected } = applyApproved(
			validationResults,
			evoConfig,
			session.session_id,
			metricsSnapshot,
			this.toolRegistry,
		);

		if (applied.length > 0) {
			updateAfterEvolution(evoConfig);
			console.log(
				`[evolution] Applied ${applied.length} changes (v${readVersion(evoConfig).version}) in ${Date.now() - startTime}ms`,
			);

			// Promote successful corrections to golden suite
			if (session.outcome === "success" && hadCorrections) {
				for (const change of applied) {
					const goldenCase: GoldenCase = {
						id: crypto.randomUUID(),
						description: `Correction: ${change.rationale.slice(0, 100)}`,
						lesson: change.content,
						session_id: session.session_id,
						created_at: new Date().toISOString(),
					};
					addCase(evoConfig, goldenCase);
				}
			}
		}

		if (rejected.length > 0) {
			console.log(`[evolution] Rejected ${rejected.length} changes`);
			for (const r of rejected) {
				console.log(`  - ${r.change.file}: ${r.reasons.join(", ")}`);
			}
		}

		// Quality Assessment (LLM only, non-blocking)
		if (this.llmJudgesEnabled && !this.isDailyCostCapReached()) {
			try {
				const qualityResult = await runQualityJudge(session, mergedForReflection);
				judgeCosts.quality_assessment.calls++;
				judgeCosts.quality_assessment.totalUsd += qualityResult.costUsd;
				judgeCosts.quality_assessment.totalInputTokens += qualityResult.inputTokens;
				judgeCosts.quality_assessment.totalOutputTokens += qualityResult.outputTokens;
				this.incrementDailyCost(qualityResult.costUsd);

				if (qualityResult.data.regression_signal) {
					console.warn(
						`[evolution] Quality judge detected regression signal: ${qualityResult.data.regression_reasoning ?? "no details"}`,
					);
				}
				console.log(
					`[evolution] Session quality: ${qualityResult.data.overall_score.toFixed(2)} (${qualityResult.data.goal_accomplished.verdict})`,
				);
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				console.warn(`[evolution] Quality judge failed (non-blocking): ${msg}`);
			}
		}

		// Step 6: Periodic Consolidation (if cadence reached)
		const metrics = readMetrics(evoConfig);
		if (metrics.sessions_since_consolidation >= evoConfig.cadence.consolidation_interval) {
			try {
				const report = runConsolidation(evoConfig);
				resetConsolidationCounter(evoConfig);
				console.log(
					`[evolution] Consolidation: ${report.principlesExtracted} principles, ` +
						`${report.observationsPruned} observations pruned`,
				);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[evolution] Consolidation failed: ${msg}`);
			}
		}

		// Check auto-rollback
		const rollbackCheck = checkForAutoRollback(evoConfig);
		if (rollbackCheck.shouldRollback) {
			console.warn(`[evolution] Auto-rollback triggered: ${rollbackCheck.reason}`);
			const currentV = readVersion(evoConfig).version;
			if (currentV > 0) {
				versionRollbackFn(evoConfig, currentV - 1);
				updateAfterRollback(evoConfig);
				console.log(`[evolution] Rolled back to version ${currentV - 1}`);
			}
		}

		// Record judge costs to persistent metrics (daily tracking already done incrementally above)
		if (this.llmJudgesEnabled) {
			this.recordJudgeCosts(judgeCosts, evoConfig);
		}

		// Enforce golden suite cap
		const maxGolden = evoConfig.judges?.max_golden_suite_size ?? 50;
		const removed = pruneSuite(evoConfig, maxGolden);
		if (removed > 0) {
			console.log(`[evolution] Pruned ${removed} oldest golden suite entries (cap: ${maxGolden})`);
		}

		return {
			version: readVersion(evoConfig).version,
			changes_applied: applied,
			changes_rejected: rejected.map((r) => ({ change: r.change, reasons: r.reasons })),
		};
	}

	getConfig(): EvolvedConfig {
		const dir = this.config.paths.config_dir;
		const version = readVersion(this.config);
		const metricsSnapshot = getMetricsSnapshot(this.config);

		return {
			constitution: readConfigFile(join(dir, "constitution.md")),
			persona: readConfigFile(join(dir, "persona.md")),
			userProfile: readConfigFile(join(dir, "user-profile.md")),
			domainKnowledge: readConfigFile(join(dir, "domain-knowledge.md")),
			strategies: {
				taskPatterns: readConfigFile(join(dir, "strategies/task-patterns.md")),
				toolPreferences: readConfigFile(join(dir, "strategies/tool-preferences.md")),
				errorRecovery: readConfigFile(join(dir, "strategies/error-recovery.md")),
			},
			meta: {
				version: version.version,
				metricsSnapshot,
			},
		};
	}

	/**
	 * Read project-scoped evolved config from a separate directory.
	 * Returns only fields that have content; the caller merges with global config.
	 */
	getProjectConfig(configDir: string): EvolvedConfig {
		const globalVersion = readVersion(this.config);
		const metricsSnapshot = getMetricsSnapshot(this.config);

		return {
			constitution: readConfigFile(join(configDir, "constitution.md")),
			persona: readConfigFile(join(configDir, "persona.md")),
			userProfile: readConfigFile(join(configDir, "user-profile.md")),
			domainKnowledge: readConfigFile(join(configDir, "domain-knowledge.md")),
			strategies: {
				taskPatterns: readConfigFile(join(configDir, "strategies/task-patterns.md")),
				toolPreferences: readConfigFile(join(configDir, "strategies/tool-preferences.md")),
				errorRecovery: readConfigFile(join(configDir, "strategies/error-recovery.md")),
			},
			meta: {
				version: globalVersion.version,
				metricsSnapshot,
			},
		};
	}

	getCurrentVersion(): number {
		return readVersion(this.config).version;
	}

	getVersionHistory(limit = 50): EvolutionVersion[] {
		return getHistory(this.config, limit);
	}

	getMetrics() {
		return readMetrics(this.config);
	}

	rollback(toVersion: number): void {
		versionRollbackFn(this.config, toVersion);
		updateAfterRollback(this.config);
		console.log(`[evolution] Rolled back to version ${toVersion}`);
	}

	private resetDailyCostIfNewDay(): void {
		const today = new Date().toISOString().slice(0, 10);
		if (this.dailyCostResetDate !== today) {
			this.dailyCostUsd = 0;
			this.dailyCostResetDate = today;
		}
	}

	private isDailyCostCapReached(): boolean {
		this.resetDailyCostIfNewDay();
		const cap = this.config.judges?.cost_cap_usd_per_day ?? 50.0;
		if (this.dailyCostUsd >= cap) {
			console.warn(
				`[evolution] Daily cost cap reached ($${this.dailyCostUsd.toFixed(2)} >= $${cap}), using heuristics`,
			);
			return true;
		}
		return false;
	}

	private incrementDailyCost(usd: number): void {
		this.resetDailyCostIfNewDay();
		this.dailyCostUsd += usd;
	}

	private recordJudgeCosts(costs: JudgeCosts, metricsConfig: EvolutionConfig = this.config): void {
		const metricsPath = metricsConfig.paths.metrics_file;
		try {
			const raw = readFileSync(metricsPath, "utf-8");
			const metrics = JSON.parse(raw);
			if (!metrics.judge_costs) {
				metrics.judge_costs = emptyJudgeCosts();
			}
			for (const key of Object.keys(costs) as Array<keyof JudgeCosts>) {
				metrics.judge_costs[key].calls += costs[key].calls;
				metrics.judge_costs[key].totalUsd += costs[key].totalUsd;
				metrics.judge_costs[key].totalInputTokens += costs[key].totalInputTokens;
				metrics.judge_costs[key].totalOutputTokens += costs[key].totalOutputTokens;
			}
			writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf-8");
		} catch {
			// Metrics file may not exist yet
		}
	}
}

function readConfigFile(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

function addCost(target: JudgeCosts[keyof JudgeCosts], source: JudgeCosts[keyof JudgeCosts]): void {
	target.calls += source.calls;
	target.totalUsd += source.totalUsd;
	target.totalInputTokens += source.totalInputTokens;
	target.totalOutputTokens += source.totalOutputTokens;
}

function mergeCosts(target: JudgeCosts, source: JudgeCosts): void {
	for (const key of Object.keys(source) as Array<keyof JudgeCosts>) {
		addCost(target[key], source[key]);
	}
}

function totalCostFromJudgeCosts(costs: JudgeCosts): number {
	let total = 0;
	for (const key of Object.keys(costs) as Array<keyof JudgeCosts>) {
		total += costs[key].totalUsd;
	}
	return total;
}
