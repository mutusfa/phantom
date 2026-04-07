/**
 * Phantom behavior eval script.
 *
 * Reads session data from the SQLite DB and scores Phantom's recent behavior
 * across the four priority metrics:
 *   1. Task completion rate (thumbs up / labeled sessions)
 *   2. Manual intervention rate (corrections + confirmation requests)
 *   3. Compute cost efficiency
 *   4. Output verbosity
 *
 * Usage:
 *   bun scripts/eval-behavior.ts [--days N]
 *
 * Prints a human-readable breakdown and a SCORE: line for harness consumption.
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type BehaviorMetrics, scoreBehavior } from "../src/eval/behavior-score.ts";

const args = process.argv.slice(2);
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 && args[daysIdx + 1] ? parseInt(args[daysIdx + 1] as string, 10) : 30;
// Baseline window: the period before the current window (same length, up to 3x)
const baselineDays = days * 3;

const dbPath = join(process.cwd(), "data", "phantom.db");
const db = new Database(dbPath, { readonly: true });

const now = Date.now();
const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const baselineSince = new Date(now - baselineDays * 24 * 60 * 60 * 1000).toISOString();

type SessionRow = {
	session_key: string;
	total_cost_usd: number;
	output_tokens: number;
	correction_count: number;
	confirmation_count: number;
	created_at: string;
};

type FeedbackRow = {
	session_key: string;
	type: string;
};

type ModelRow = {
	model: string;
	count: number;
};

const sessions = db
	.query<SessionRow, [string]>(
		`SELECT session_key, total_cost_usd, output_tokens,
		        correction_count, confirmation_count, created_at
		 FROM sessions
		 WHERE created_at >= ? AND channel_id != 'scheduler'
		 ORDER BY created_at ASC`,
	)
	.all(since);

// Baseline: sessions in the prior window (before the current period)
type BaselineRow = { avg_cost: number; avg_tokens: number; count: number };
const baselineRow = db
	.query<BaselineRow, [string, string]>(
		`SELECT AVG(total_cost_usd) as avg_cost,
		        AVG(output_tokens)  as avg_tokens,
		        COUNT(*)            as count
		 FROM sessions
		 WHERE created_at >= ? AND created_at < ? AND channel_id != 'scheduler'`,
	)
	.get(baselineSince, since);

// session_feedback may not exist yet on older installs
let feedback: FeedbackRow[] = [];
try {
	feedback = db
		.query<FeedbackRow, [string]>(
			`SELECT session_key, type FROM session_feedback WHERE created_at >= ?`,
		)
		.all(since);
} catch {
	// Table not yet migrated - treat as no feedback data
}

const modelRows = db
	.query<ModelRow, [string]>(
		`SELECT model, COUNT(*) as count FROM cost_events WHERE created_at >= ? GROUP BY model`,
	)
	.all(since);

const modelDistribution: Record<string, number> = {};
for (const row of modelRows) {
	modelDistribution[row.model] = row.count;
}

const positiveReactions = feedback.filter((f) => f.type === "positive");
const labeledSessions = new Set(feedback.map((f) => f.session_key)).size;

const totalSessions = sessions.length;
const totalCost = sessions.reduce((sum, s) => sum + s.total_cost_usd, 0);
const totalOutputTokens = sessions.reduce((sum, s) => sum + s.output_tokens, 0);
const totalCorrections = sessions.reduce((sum, s) => sum + s.correction_count, 0);
const totalConfirmations = sessions.reduce((sum, s) => sum + s.confirmation_count, 0);

const hasBaseline = baselineRow !== null && baselineRow.count >= 5;

const metrics: BehaviorMetrics = {
	thumbsUpCount: positiveReactions.length,
	labeledSessionCount: labeledSessions,
	correctionCount: totalCorrections,
	confirmationCount: totalConfirmations,
	totalSessionCount: totalSessions,
	avgCostUsd: totalSessions > 0 ? totalCost / totalSessions : 0,
	modelDistribution,
	baselineCostUsd: hasBaseline ? baselineRow.avg_cost : null,
	avgOutputTokens: totalSessions > 0 ? totalOutputTokens / totalSessions : 0,
	baselineOutputTokens: hasBaseline ? baselineRow.avg_tokens : null,
};

const score = scoreBehavior(metrics);

const baselineNote = hasBaseline
	? `baseline: ${baselineRow.count} sessions from prior ${baselineDays - days} days`
	: "baseline: not enough history yet (need ≥5 sessions in prior window)";

console.log(`\n=== Phantom Behavior Eval (last ${days} days, ${totalSessions} sessions | ${baselineNote}) ===\n`);
console.log(score.breakdown);
console.log(`\nWeighted total: ${(score.total * 100).toFixed(1)}/100`);
console.log(`SCORE: ${score.total.toFixed(2)}`);

db.close();
