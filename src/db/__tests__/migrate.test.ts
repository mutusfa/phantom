import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LOCAL_MIGRATIONS } from "../schema.local.ts";
import { MIGRATIONS } from "../schema.ts";
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
		expect(tables).toContain("chat_run_timelines");
		expect(tables).toContain("firstboot_state");
		expect(tables).toContain("_migrations");
	});

	test("is idempotent - running twice does not fail", () => {
		const db = freshDb();
		runMigrations(db);
		runMigrations(db);

		const migrationCount = db.query("SELECT COUNT(*) as count FROM _migrations").get() as { count: number };
		expect(migrationCount.count).toBe(MIGRATIONS.length + LOCAL_MIGRATIONS.length);
	});

	test("tracks applied migration indices", () => {
		const db = freshDb();
		runMigrations(db);

		const indices = db
			.query("SELECT index_num FROM _migrations ORDER BY index_num")
			.all()
			.map((r) => (r as { index_num: number }).index_num);

		const total = MIGRATIONS.length + LOCAL_MIGRATIONS.length;
		expect(indices).toEqual(Array.from({ length: total }, (_, i) => i));
	});

	test("subagent_audit_log has frontmatter JSON columns after migration", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(subagent_audit_log)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("previous_frontmatter_json");
		expect(cols).toContain("new_frontmatter_json");
	});

	test("evolution_queue table exists after migration", () => {
		const db = freshDb();
		runMigrations(db);
		const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='evolution_queue'").get() as {
			name: string;
		} | null;
		expect(row).not.toBeNull();
		expect(row?.name).toBe("evolution_queue");
	});

	test("chat_run_timelines table and indexes exist after migration", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(chat_run_timelines)")
			.all()
			.map((r) => (r as { name: string }).name);
		const indexes = db
			.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chat_run_timelines' ORDER BY name")
			.all()
			.map((r) => (r as { name: string }).name);

		expect(cols).toContain("summary_json");
		expect(cols).toContain("assistant_message_id");
		expect(indexes).toContain("idx_chat_run_timelines_session_start");
		expect(indexes).toContain("idx_chat_run_timelines_user");
		expect(indexes).toContain("idx_chat_run_timelines_assistant");
	});
});
