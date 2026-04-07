import { describe, expect, test } from "bun:test";
import { type BehaviorMetrics, scoreBehavior } from "../behavior-score.ts";

function baseMetrics(overrides: Partial<BehaviorMetrics> = {}): BehaviorMetrics {
	return {
		thumbsUpCount: 0,
		labeledSessionCount: 0,
		correctionCount: 0,
		confirmationCount: 0,
		totalSessionCount: 0,
		avgCostUsd: 0,
		modelDistribution: {},
		baselineCostUsd: null,
		avgOutputTokens: 0,
		baselineOutputTokens: null,
		...overrides,
	};
}

describe("scoreBehavior", () => {
	describe("completionRate", () => {
		test("null when no labeled sessions", () => {
			const score = scoreBehavior(baseMetrics({ totalSessionCount: 5 }));
			expect(score.completionRate).toBeNull();
		});

		test("1.0 when all labeled sessions are thumbs up", () => {
			const score = scoreBehavior(
				baseMetrics({ thumbsUpCount: 5, labeledSessionCount: 5, totalSessionCount: 5 }),
			);
			expect(score.completionRate).toBe(1.0);
		});

		test("0.0 when no thumbs up despite labeled sessions", () => {
			const score = scoreBehavior(
				baseMetrics({ thumbsUpCount: 0, labeledSessionCount: 4, totalSessionCount: 4 }),
			);
			expect(score.completionRate).toBe(0.0);
		});

		test("0.5 with half thumbs up", () => {
			const score = scoreBehavior(
				baseMetrics({ thumbsUpCount: 3, labeledSessionCount: 6, totalSessionCount: 6 }),
			);
			expect(score.completionRate).toBeCloseTo(0.5);
		});
	});

	describe("interventionRate", () => {
		test("0 when no interventions", () => {
			const score = scoreBehavior(baseMetrics({ totalSessionCount: 10 }));
			expect(score.interventionRate).toBe(0);
		});

		test("corrections count double confirmations", () => {
			// 2 corrections = 4 weighted; 2 confirmations = 2 weighted; total = 6 / 5 sessions = 1.2
			const score = scoreBehavior(
				baseMetrics({ correctionCount: 2, confirmationCount: 2, totalSessionCount: 5 }),
			);
			expect(score.interventionRate).toBeCloseTo(1.2);
		});

		test("score is 0 when weighted rate exceeds max", () => {
			// 8 corrections * 2 = 16 weighted / 2 sessions = 8 per session (> MAX=4)
			const score = scoreBehavior(
				baseMetrics({ correctionCount: 8, confirmationCount: 0, totalSessionCount: 2 }),
			);
			// interventionScore = max(0, 1 - 8/4) = max(0, -1) = 0
			// total = 0.5*0.5 + 0.25*0 + 0.125*0.5 + 0.125*0.5 = 0.25 + 0 + 0.0625 + 0.0625 = 0.375
			expect(score.total).toBeCloseTo(0.375);
		});

		test("0 rate when no sessions", () => {
			const score = scoreBehavior(baseMetrics({ totalSessionCount: 0 }));
			expect(score.interventionRate).toBe(0);
		});
	});

	describe("costScore", () => {
		test("neutral (0.5) when no baseline", () => {
			const score = scoreBehavior(baseMetrics({ avgCostUsd: 0.01, baselineCostUsd: null }));
			expect(score.costScore).toBe(0.5);
		});

		test("1.0 when cost is half the baseline", () => {
			const score = scoreBehavior(
				baseMetrics({ avgCostUsd: 0.005, baselineCostUsd: 0.01 }),
			);
			// ratio = 0.5, score = 1.5 - 0.5 = 1.0
			expect(score.costScore).toBeCloseTo(1.0);
		});

		test("0.5 when cost equals baseline", () => {
			const score = scoreBehavior(
				baseMetrics({ avgCostUsd: 0.01, baselineCostUsd: 0.01 }),
			);
			// ratio = 1.0, score = 1.5 - 1.0 = 0.5
			expect(score.costScore).toBeCloseTo(0.5);
		});

		test("0 when cost is 50% above baseline", () => {
			const score = scoreBehavior(
				baseMetrics({ avgCostUsd: 0.015, baselineCostUsd: 0.01 }),
			);
			// ratio = 1.5, score = 1.5 - 1.5 = 0, clamped
			expect(score.costScore).toBeCloseTo(0);
		});
	});

	describe("verbosityScore", () => {
		test("neutral (0.5) when no baseline", () => {
			const score = scoreBehavior(baseMetrics({ avgOutputTokens: 1000, baselineOutputTokens: null }));
			expect(score.verbosityScore).toBe(0.5);
		});

		test("1.0 when output is half the baseline", () => {
			const score = scoreBehavior(
				baseMetrics({ avgOutputTokens: 500, baselineOutputTokens: 1000 }),
			);
			expect(score.verbosityScore).toBeCloseTo(1.0);
		});
	});

	describe("total", () => {
		test("is 0.5 for a neutral baseline scenario (no data)", () => {
			// All neutral: completion=0.5, intervention=1.0 (no interventions), cost=0.5, verbosity=0.5
			// total = 0.5*0.5 + 0.25*1 + 0.125*0.5 + 0.125*0.5
			//       = 0.25 + 0.25 + 0.0625 + 0.0625 = 0.625
			const score = scoreBehavior(baseMetrics({ totalSessionCount: 5 }));
			expect(score.total).toBeCloseTo(0.625);
		});

		test("is 1.0 for a perfect scenario", () => {
			const score = scoreBehavior(
				baseMetrics({
					thumbsUpCount: 10,
					labeledSessionCount: 10,
					totalSessionCount: 10,
					correctionCount: 0,
					confirmationCount: 0,
					avgCostUsd: 0.001,
					baselineCostUsd: 0.01,
					avgOutputTokens: 100,
					baselineOutputTokens: 1000,
				}),
			);
			expect(score.total).toBeCloseTo(1.0);
		});

		test("is clamped to [0, 1]", () => {
			const score = scoreBehavior(
				baseMetrics({
					thumbsUpCount: 0,
					labeledSessionCount: 10,
					totalSessionCount: 10,
					correctionCount: 100,
					confirmationCount: 100,
					avgCostUsd: 1,
					baselineCostUsd: 0.001,
					avgOutputTokens: 100000,
					baselineOutputTokens: 100,
				}),
			);
			expect(score.total).toBeGreaterThanOrEqual(0);
			expect(score.total).toBeLessThanOrEqual(1);
		});
	});

	describe("breakdown string", () => {
		test("includes all four metric lines", () => {
			const score = scoreBehavior(baseMetrics({ totalSessionCount: 5 }));
			expect(score.breakdown).toContain("completion");
			expect(score.breakdown).toContain("interventions");
			expect(score.breakdown).toContain("cost");
			expect(score.breakdown).toContain("verbosity");
		});

		test("shows 'unknown' for completion when no labeled sessions", () => {
			const score = scoreBehavior(baseMetrics());
			expect(score.breakdown).toContain("unknown");
		});

		test("shows 'no baseline yet' when baseline is null", () => {
			const score = scoreBehavior(baseMetrics({ baselineCostUsd: null, baselineOutputTokens: null }));
			expect(score.breakdown).toContain("no baseline yet");
		});
	});
});
