import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { SessionStore } from "../../agent/session-store.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ProjectRegistry } from "../registry.ts";
import { resolveProjectForQuery } from "../resolve-for-query.ts";

describe("resolveProjectForQuery", () => {
	let db: Database;
	let registry: ProjectRegistry;
	let sessions: SessionStore;

	beforeEach(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
		registry = new ProjectRegistry(db);
		sessions = new SessionStore(db);
	});

	test("returns null merged when no project", () => {
		const r = resolveProjectForQuery(registry, null, "slack", "C1:T1");
		expect(r.project).toBeNull();
		expect(r.mergedEvolvedForQuery).toBeNull();
		expect(r.projectEvolutionConfigDir).toBeNull();
	});

	test("explicit projectName resolves project and options", () => {
		registry.register("alpha", "/tmp/wd");
		const r = resolveProjectForQuery(registry, null, "mcp", "ask-1", { projectName: "alpha" });
		expect(r.project?.name).toBe("alpha");
		expect(r.projectOptions?.cwd).toBe("/tmp/wd");
		expect(r.mergedEvolvedForQuery).toBeNull();
		expect(r.projectEvolutionConfigDir).toBeNull();
	});

	test("session project_id binding is used without explicit", () => {
		sessions.create("slack", "thread-1");
		const p = registry.register("bound");
		registry.setSessionProject("slack:thread-1", p.id);
		const r = resolveProjectForQuery(registry, null, "slack", "thread-1");
		expect(r.project?.name).toBe("bound");
	});
});
