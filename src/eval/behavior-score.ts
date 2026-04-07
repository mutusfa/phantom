/**
 * Scoring formula for Phantom's behavior quality.
 *
 * Four metrics in priority order:
 *   1. Completion rate  - thumbs up / labeled sessions (weight 0.50)
 *   2. Intervention rate - corrections (2x) + confirmations (1x) per session (weight 0.25)
 *   3. Compute cost     - avg cost vs target (weight 0.125)
 *   4. Verbosity        - avg output tokens vs target (weight 0.125)
 *
 * Baselines are calibrated to what "good" looks like for Phantom's workload.
 * Adjust them here if the workload character changes significantly.
 */

export type BehaviorMetrics = {
	// Metric 1
	thumbsUpCount: number;
	/** Sessions where we have any explicit feedback signal (positive or negative) */
	labeledSessionCount: number;
	// Metric 2
	/** Heuristic-detected user corrections (higher severity) */
	correctionCount: number;
	/** Heuristic-detected unnecessary confirmation requests (lower severity) */
	confirmationCount: number;
	totalSessionCount: number;
	// Metric 3
	avgCostUsd: number;
	/** model -> number of sessions using that model */
	modelDistribution: Record<string, number>;
	/**
	 * Historical average cost from a prior period (days 31-90 by default).
	 * Null if not enough history to compute - cost score defaults to neutral (0.5).
	 */
	baselineCostUsd: number | null;
	// Metric 4
	avgOutputTokens: number;
	/**
	 * Historical average output tokens from the same prior period.
	 * Null if not enough history - verbosity score defaults to neutral (0.5).
	 */
	baselineOutputTokens: number | null;
};

export type BehaviorScore = {
	/** Composite 0.0-1.0 */
	total: number;
	/** null if no labeled sessions yet */
	completionRate: number | null;
	/** Weighted interventions per session */
	interventionRate: number;
	costScore: number;
	verbosityScore: number;
	breakdown: string;
};

const WEIGHTS = {
	completion: 0.50,
	intervention: 0.25,
	cost: 0.125,
	verbosity: 0.125,
} as const;

/**
 * Weighted interventions per session at which the intervention score reaches 0.0.
 * 4 means: 2 corrections + 0 confirmations per session = score 0.
 */
const MAX_INTERVENTIONS_PER_SESSION = 4;

/**
 * Maps a "lower is better" ratio (current / baseline) to a 0-1 score.
 *
 * ratio = 0.5  → score 1.0  (half the historical average - great)
 * ratio = 1.0  → score 0.5  (at historical average - neutral)
 * ratio = 1.5  → score 0.0  (50% above historical average - bad)
 *
 * Linear between those points, clamped to [0, 1].
 */
function ratioScore(current: number, baseline: number): number {
	if (baseline <= 0) return 0.5;
	return Math.max(0, Math.min(1, 1.5 - current / baseline));
}

export function scoreBehavior(m: BehaviorMetrics): BehaviorScore {
	// Metric 1: completion rate
	const completionRate = m.labeledSessionCount > 0 ? m.thumbsUpCount / m.labeledSessionCount : null;
	// Unknown = neutral (0.5), not penalised for lack of data
	const completionScore = completionRate ?? 0.5;

	// Metric 2: intervention rate - corrections count double
	const weightedInterventions =
		m.totalSessionCount > 0
			? (m.correctionCount * 2 + m.confirmationCount) / m.totalSessionCount
			: 0;
	const interventionScore = Math.max(0, 1 - weightedInterventions / MAX_INTERVENTIONS_PER_SESSION);

	// Metric 3: cost - relative to historical baseline, neutral (0.5) if no history
	const costScore = m.baselineCostUsd !== null ? ratioScore(m.avgCostUsd, m.baselineCostUsd) : 0.5;

	// Metric 4: verbosity - relative to historical baseline, neutral (0.5) if no history
	const verbosityScore =
		m.baselineOutputTokens !== null ? ratioScore(m.avgOutputTokens, m.baselineOutputTokens) : 0.5;

	const total =
		completionScore * WEIGHTS.completion +
		interventionScore * WEIGHTS.intervention +
		costScore * WEIGHTS.cost +
		verbosityScore * WEIGHTS.verbosity;

	const modelLine =
		Object.entries(m.modelDistribution)
			.sort(([, a], [, b]) => b - a)
			.map(([model, count]) => `${model.split("-").slice(-2).join("-")}:${count}`)
			.join(", ") || "none";

	const costBaselinePart =
		m.baselineCostUsd !== null ? ` vs $${m.baselineCostUsd.toFixed(4)} baseline` : " (no baseline yet)";
	const verbosityBaselinePart =
		m.baselineOutputTokens !== null
			? ` vs ${Math.round(m.baselineOutputTokens)} baseline`
			: " (no baseline yet)";

	const breakdown = [
		`completion  : ${completionRate !== null ? `${(completionRate * 100).toFixed(0)}%` : "unknown"} (${m.thumbsUpCount} 👍 / ${m.labeledSessionCount} labeled) → ${(completionScore * 100).toFixed(0)}/100`,
		`interventions: ${weightedInterventions.toFixed(2)}/session (${m.correctionCount} corrections × 2 + ${m.confirmationCount} confirmations) → ${(interventionScore * 100).toFixed(0)}/100`,
		`cost        : $${m.avgCostUsd.toFixed(4)}/session${costBaselinePart}  [models: ${modelLine}] → ${(costScore * 100).toFixed(0)}/100`,
		`verbosity   : ${Math.round(m.avgOutputTokens)} output tokens/session${verbosityBaselinePart} → ${(verbosityScore * 100).toFixed(0)}/100`,
	].join("\n");

	return { total, completionRate, interventionRate: weightedInterventions, costScore, verbosityScore, breakdown };
}
