import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type CostBreakdownRow, aggregateCostBreakdown } from "../agent/cost-breakdown-report.ts";

function printRow(r: CostBreakdownRow): void {
	const usd = r.totalUsd.toFixed(4);
	const hit = (r.meanCacheHitRate * 100).toFixed(1);
	console.log(
		[
			r.source.padEnd(22),
			String(r.calls).padStart(6),
			usd.padStart(12),
			r.meanInputTokens.toFixed(0).padStart(10),
			r.p95InputTokens.toFixed(0).padStart(10),
			r.meanOutputTokens.toFixed(0).padStart(10),
			`${hit}%`.padStart(8),
		].join("  "),
	);
}

export async function runCostBreakdown(argv: string[]): Promise<void> {
	const parsed = parseArgs({
		args: argv,
		options: {
			days: { type: "string", default: "14" },
			db: { type: "string", default: "data/phantom.db" },
			help: { type: "boolean", short: "h", default: false },
		},
		strict: true,
		allowPositionals: false,
	});

	if (parsed.values.help) {
		console.log(`Usage: phantom cost-breakdown [--days <n>] [--db <path>]

Aggregates cost_events by source over the last N calendar days (default 14).

Sources:
  main_agent          Normal channel traffic (Slack, chat, CLI, etc.)
  reflection          reflection-internal synthetic sessions
  evolution_gate      Haiku gate per session
  aux_chat_rename     Chat session auto-title
  aux_scheduler_parse Scheduler job description parse (Sonnet)
  aux_judge_other     Other aux judge calls
  orphan              cost_events with no matching sessions row
`);
		return;
	}

	const daysRaw = Number.parseInt(parsed.values.days ?? "14", 10);
	const days = Number.isFinite(daysRaw) ? daysRaw : 14;
	const dbPath = resolve(process.cwd(), parsed.values.db ?? "data/phantom.db");
	if (!existsSync(dbPath)) {
		throw new Error(`Database file not found: ${dbPath}`);
	}
	// Bun accepts `readonly`, not `readwrite` (invalid flags raise SQLITE_MISUSE).
	const db = new Database(dbPath, { readonly: true });

	const rows = aggregateCostBreakdown(db, days);
	db.close();

	console.log(`Cost breakdown (last ${days} days)  db=${dbPath}\n`);
	console.log(
		[
			"source".padEnd(22),
			"calls".padStart(6),
			"USD".padStart(12),
			"mean_in".padStart(10),
			"p95_in".padStart(10),
			"mean_out".padStart(10),
			"cache%".padStart(8),
		].join("  "),
	);
	console.log("-".repeat(92));
	for (const r of rows) {
		if (r.calls === 0 && r.totalUsd === 0) continue;
		printRow(r);
	}
	const totalUsd = rows.reduce((s, r) => s + r.totalUsd, 0);
	const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
	console.log("-".repeat(92));
	console.log(`${"TOTAL".padEnd(22)}  ${String(totalCalls).padStart(6)}  ${totalUsd.toFixed(4).padStart(12)}`);
}
