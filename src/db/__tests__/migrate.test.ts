import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../migrate.ts";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");
	return db;
}

describe("runMigrations", () => {
	test("creates sessions, cost_events, onboarding_state, dynamic_tools, and scheduled_jobs tables", () => {
		const db = freshDb();
		runMigrations(db);

		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all()
			.map((r) => (r as { name: string }).name);

		expect(tables).toContain("sessions");
		expect(tables).toContain("cost_events");
		expect(tables).toContain("onboarding_state");
		expect(tables).toContain("dynamic_tools");
		expect(tables).toContain("scheduled_jobs");
		expect(tables).toContain("secrets");
		expect(tables).toContain("secret_requests");
		expect(tables).toContain("_migrations");
	});

	test("is idempotent - running twice does not fail", () => {
		const db = freshDb();
		runMigrations(db);
		const countAfterOne = (db.query("SELECT COUNT(*) as count FROM _migrations").get() as { count: number }).count;
		runMigrations(db);
		const countAfterTwo = (db.query("SELECT COUNT(*) as count FROM _migrations").get() as { count: number }).count;

		expect(countAfterTwo).toBe(countAfterOne);
	});

	test("tracks applied migration indices as a contiguous sequence from 0", () => {
		const db = freshDb();
		runMigrations(db);

		const indices = db
			.query("SELECT index_num FROM _migrations ORDER BY index_num")
			.all()
			.map((r) => (r as { index_num: number }).index_num);

		const expected = indices.map((_, i) => i);
		expect(indices).toEqual(expected);
	});
});
