import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import { SessionStore } from "../../agent/session-store.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ProjectRegistry } from "../registry.ts";

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

describe("ProjectRegistry", () => {
	test("registers a project with name only", () => {
		const cwd = process.cwd();
		const project = registry.register("my-project");
		expect(project.name).toBe("my-project");
		expect(project.working_dir).toBeNull();
		expect(project.context_path).toBe(join(cwd, "data", "projects", "my-project", "context.md"));
		expect(project.evolution_config_dir).toBe(join(cwd, "data", "projects", "my-project", "evolved"));
		expect(project.id).toBeGreaterThan(0);
	});

	test("prefers harness context.md when present and context_path not passed", () => {
		const cwd = process.cwd();
		const name = `harness-pref-${Date.now()}`;
		const harnessDir = join(cwd, "data", "harness-runs", name);
		mkdirSync(harnessDir, { recursive: true });
		writeFileSync(join(harnessDir, "context.md"), "# harness ctx\n", "utf-8");
		try {
			const project = registry.register(name);
			expect(project.context_path).toBe(join(cwd, "data", "harness-runs", name, "context.md"));
			expect(project.evolution_config_dir).toBe(join(cwd, "data", "projects", name, "evolved"));
		} finally {
			rmSync(join(cwd, "data", "harness-runs", name), { recursive: true, force: true });
			registry.remove(name);
		}
	});

	test("explicit context_path is not overridden by harness file", () => {
		const cwd = process.cwd();
		const name = `explicit-ctx-${Date.now()}`;
		const harnessDir = join(cwd, "data", "harness-runs", name);
		mkdirSync(harnessDir, { recursive: true });
		writeFileSync(join(harnessDir, "context.md"), "# harness\n", "utf-8");
		try {
			const custom = "/tmp/custom-context.md";
			const project = registry.register(name, undefined, custom);
			expect(project.context_path).toBe(custom);
		} finally {
			registry.remove(name);
			rmSync(join(cwd, "data", "harness-runs", name), { recursive: true, force: true });
		}
	});

	test("registers a project with working_dir and context_path", () => {
		const project = registry.register("ds-project", "/home/user/ds-project", "/home/user/ds-project/context.md");
		expect(project.name).toBe("ds-project");
		expect(project.working_dir).toBe("/home/user/ds-project");
		expect(project.context_path).toBe("/home/user/ds-project/context.md");
	});

	test("get returns project by name", () => {
		registry.register("alpha");
		const found = registry.get("alpha");
		expect(found).not.toBeNull();
		expect(found!.name).toBe("alpha");
	});

	test("get returns null for unknown name", () => {
		expect(registry.get("nope")).toBeNull();
	});

	test("getById returns project by id", () => {
		const created = registry.register("beta");
		const found = registry.getById(created.id);
		expect(found).not.toBeNull();
		expect(found!.name).toBe("beta");
	});

	test("getById returns null for unknown id", () => {
		expect(registry.getById(999)).toBeNull();
	});

	test("list returns all projects", () => {
		registry.register("one");
		registry.register("two");
		registry.register("three");
		const all = registry.list();
		expect(all).toHaveLength(3);
		expect(all.map((p) => p.name).sort()).toEqual(["one", "three", "two"]);
	});

	test("list returns empty array when no projects exist", () => {
		expect(registry.list()).toEqual([]);
	});

	test("update modifies working_dir", () => {
		registry.register("updatable");
		const updated = registry.update("updatable", { working_dir: "/new/path" });
		expect(updated.working_dir).toBe("/new/path");

		const fetched = registry.get("updatable");
		expect(fetched!.working_dir).toBe("/new/path");
	});

	test("update modifies context_path", () => {
		registry.register("updatable");
		const updated = registry.update("updatable", { context_path: "/ctx.md" });
		expect(updated.context_path).toBe("/ctx.md");
	});

	test("update throws for unknown project", () => {
		expect(() => registry.update("ghost", { working_dir: "/x" })).toThrow("not found");
	});

	test("remove deletes a project", () => {
		registry.register("doomed");
		const removed = registry.remove("doomed");
		expect(removed).toBe(true);
		expect(registry.get("doomed")).toBeNull();
	});

	test("remove returns false for unknown project", () => {
		expect(registry.remove("ghost")).toBe(false);
	});

	test("register rejects duplicate names", () => {
		registry.register("unique");
		expect(() => registry.register("unique")).toThrow();
	});

	test("setSessionProject and getSessionProject round-trip", () => {
		sessions.create("slack", "conv-1");
		const project = registry.register("linked");
		registry.setSessionProject("slack:conv-1", project.id);
		expect(registry.getSessionProject("slack:conv-1")).toBe(project.id);
	});

	test("getSessionProject returns null for unbound session", () => {
		sessions.create("slack", "orphan");
		expect(registry.getSessionProject("slack:orphan")).toBeNull();
	});

	test("clearSessionProject removes the binding", () => {
		sessions.create("slack", "conv-2");
		const project = registry.register("temp-link");
		registry.setSessionProject("slack:conv-2", project.id);
		registry.clearSessionProject("slack:conv-2");
		expect(registry.getSessionProject("slack:conv-2")).toBeNull();
	});
});
