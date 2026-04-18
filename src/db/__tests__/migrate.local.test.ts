// Tests for local schema additions (schema.local.ts).
// This file is not part of the upstream repo and will never conflict.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../migrate.ts";

function freshDb(): Database {
	const db = new Database(":memory:");
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");
	return db;
}

describe("local migrations", () => {
	test("cache token columns exist on cost_events", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(cost_events)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("cache_read_tokens");
		expect(cols).toContain("cache_creation_tokens");
	});

	test("cache token columns exist on sessions", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(sessions)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("cache_read_tokens");
		expect(cols).toContain("cache_creation_tokens");
	});

	test("session_feedback table exists", () => {
		const db = freshDb();
		runMigrations(db);
		const row = db
			.query("SELECT name FROM sqlite_master WHERE type='table' AND name='session_feedback'")
			.get() as { name: string } | null;
		expect(row?.name).toBe("session_feedback");
	});

	test("sessions has correction_count and confirmation_count columns", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(sessions)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("correction_count");
		expect(cols).toContain("confirmation_count");
	});

	test("projects table exists with all columns", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(projects)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("id");
		expect(cols).toContain("name");
		expect(cols).toContain("working_dir");
		expect(cols).toContain("context_path");
		expect(cols).toContain("evolution_config_dir");
	});

	test("sessions has project_id column", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(sessions)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("project_id");
	});

	test("scheduled_jobs has project_name column", () => {
		const db = freshDb();
		runMigrations(db);
		const cols = db
			.query("PRAGMA table_info(scheduled_jobs)")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(cols).toContain("project_name");
	});
});
