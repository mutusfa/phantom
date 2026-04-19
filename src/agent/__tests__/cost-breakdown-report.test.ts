import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../db/migrate.ts";
import { aggregateCostBreakdown, classifyCostSource } from "../cost-breakdown-report.ts";
import { COST_CHANNEL_AUX_JUDGE, COST_CHANNEL_EVOLUTION_GATE, COST_CHANNEL_REFLECTION } from "../cost-source.ts";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");
	runMigrations(db);
	return db;
}

describe("classifyCostSource", () => {
	test("maps synthetic channels to breakdown buckets", () => {
		expect(classifyCostSource(COST_CHANNEL_REFLECTION, "batch-1")).toBe("reflection");
		expect(classifyCostSource(COST_CHANNEL_EVOLUTION_GATE, "s1")).toBe("evolution_gate");
		expect(classifyCostSource(COST_CHANNEL_AUX_JUDGE, "chat-rename:abc")).toBe("aux_chat_rename");
		expect(classifyCostSource(COST_CHANNEL_AUX_JUDGE, "scheduler-parse:xyz")).toBe("aux_scheduler_parse");
		expect(classifyCostSource(COST_CHANNEL_AUX_JUDGE, "other")).toBe("aux_judge_other");
		expect(classifyCostSource("slack", "C1:T1")).toBe("main_agent");
		expect(classifyCostSource(null, null)).toBe("orphan");
	});
});

describe("aggregateCostBreakdown", () => {
	test("groups rows by source and computes means", () => {
		const db = freshDb();
		const insertSession = (key: string, channel: string, conv: string): void => {
			db.run("INSERT INTO sessions (session_key, channel_id, conversation_id) VALUES (?, ?, ?)", [key, channel, conv]);
		};
		insertSession("slack:a:b", "slack", "a/b");
		insertSession("reflection-internal:d1", COST_CHANNEL_REFLECTION, "d1");
		insertSession("gate:s1", COST_CHANNEL_EVOLUTION_GATE, "s1");
		db.run(
			`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model)
       VALUES (?, 1.0, 1000, 50, 900, 100, 'x')`,
			["slack:a:b"],
		);
		db.run(
			`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model)
       VALUES (?, 2.0, 2000, 100, 0, 0, 'y')`,
			["reflection-internal:d1"],
		);
		db.run(
			`INSERT INTO cost_events (session_key, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model)
       VALUES (?, 0.01, 400, 20, 0, 0, 'z')`,
			["gate:s1"],
		);
		const rows = aggregateCostBreakdown(db, 14);
		db.close();
		const main = rows.find((r) => r.source === "main_agent");
		const refl = rows.find((r) => r.source === "reflection");
		const gate = rows.find((r) => r.source === "evolution_gate");
		expect(main?.calls).toBe(1);
		expect(main?.totalUsd).toBeCloseTo(1, 5);
		expect(main?.meanInputTokens).toBeCloseTo(1000, 5);
		expect(main?.meanCacheHitRate).toBeCloseTo(0.9, 5);
		expect(refl?.calls).toBe(1);
		expect(refl?.totalUsd).toBeCloseTo(2, 5);
		expect(gate?.calls).toBe(1);
		expect(gate?.totalUsd).toBeCloseTo(0.01, 5);
	});
});
