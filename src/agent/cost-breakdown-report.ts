import type { Database } from "bun:sqlite";
import { COST_CHANNEL_AUX_JUDGE, COST_CHANNEL_EVOLUTION_GATE, COST_CHANNEL_REFLECTION } from "./cost-source.ts";

export type CostBreakdownSource =
	| "main_agent"
	| "reflection"
	| "evolution_gate"
	| "aux_chat_rename"
	| "aux_scheduler_parse"
	| "aux_judge_other"
	| "orphan";

export type CostBreakdownRow = {
	source: CostBreakdownSource;
	calls: number;
	totalUsd: number;
	meanInputTokens: number;
	p95InputTokens: number;
	meanOutputTokens: number;
	meanCacheHitRate: number;
};

type RawEvent = {
	cost_usd: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
	channel_id: string | null;
	conversation_id: string | null;
};

export function classifyCostSource(channelId: string | null, conversationId: string | null): CostBreakdownSource {
	if (!channelId) return "orphan";
	if (channelId === COST_CHANNEL_REFLECTION) return "reflection";
	if (channelId === COST_CHANNEL_EVOLUTION_GATE) return "evolution_gate";
	if (channelId === COST_CHANNEL_AUX_JUDGE) {
		const conv = conversationId ?? "";
		if (conv.startsWith("chat-rename:")) return "aux_chat_rename";
		if (conv.startsWith("scheduler-parse:")) return "aux_scheduler_parse";
		return "aux_judge_other";
	}
	return "main_agent";
}

function percentile95(sorted: number[]): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
	return sorted[idx] ?? 0;
}

function cacheHitRatio(row: RawEvent): number | null {
	const r = row.cache_read_tokens;
	const c = row.cache_creation_tokens;
	const denom = r + c;
	if (denom <= 0) return null;
	return r / denom;
}

function summarize(rows: RawEvent[]): Omit<CostBreakdownRow, "source"> {
	const calls = rows.length;
	if (calls === 0) {
		return {
			calls: 0,
			totalUsd: 0,
			meanInputTokens: 0,
			p95InputTokens: 0,
			meanOutputTokens: 0,
			meanCacheHitRate: 0,
		};
	}
	const totalUsd = rows.reduce((s, r) => s + r.cost_usd, 0);
	const meanInputTokens = rows.reduce((s, r) => s + r.input_tokens, 0) / calls;
	const meanOutputTokens = rows.reduce((s, r) => s + r.output_tokens, 0) / calls;
	const sortedIn = rows.map((r) => r.input_tokens).sort((a, b) => a - b);
	const p95InputTokens = percentile95(sortedIn);
	const ratios = rows.map(cacheHitRatio).filter((x): x is number => x !== null);
	const meanCacheHitRate = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
	return {
		calls,
		totalUsd,
		meanInputTokens,
		p95InputTokens,
		meanOutputTokens,
		meanCacheHitRate,
	};
}

const SOURCE_ORDER: CostBreakdownSource[] = [
	"main_agent",
	"reflection",
	"evolution_gate",
	"aux_chat_rename",
	"aux_scheduler_parse",
	"aux_judge_other",
	"orphan",
];

/**
 * Aggregate `cost_events` joined to `sessions` over a time window. One row
 * per cost source suitable for CLI or tests.
 */
export function aggregateCostBreakdown(db: Database, days: number): CostBreakdownRow[] {
	const safeDays = Math.max(1, Math.min(3660, Math.floor(days)));
	// Bun's sqlite binding treats `datetime('now', '-' || ? || ' days')` as
	// invalid (returns null). `safeDays` is clamped to an integer above, so
	// embedding the literal modifier is safe.
	const rows = db
		.query(
			`SELECT ce.cost_usd as cost_usd, ce.input_tokens as input_tokens, ce.output_tokens as output_tokens,
              ce.cache_read_tokens as cache_read_tokens, ce.cache_creation_tokens as cache_creation_tokens,
              s.channel_id as channel_id, s.conversation_id as conversation_id
       FROM cost_events ce
       LEFT JOIN sessions s ON s.session_key = ce.session_key
       WHERE ce.created_at >= datetime('now', '-${safeDays} days')`,
		)
		.all() as RawEvent[];

	const bySource = new Map<CostBreakdownSource, RawEvent[]>();
	for (const s of SOURCE_ORDER) {
		bySource.set(s, []);
	}
	for (const row of rows) {
		const src = classifyCostSource(row.channel_id, row.conversation_id);
		const bucket = bySource.get(src) ?? [];
		bucket.push(row);
		bySource.set(src, bucket);
	}

	return SOURCE_ORDER.map((source) => ({
		source,
		...summarize(bySource.get(source) ?? []),
	}));
}
