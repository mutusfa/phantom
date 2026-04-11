import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { SessionStore } from "../../agent/session-store.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ProjectRegistry } from "../registry.ts";
import { createProjectToolServer } from "../tool.ts";

describe("createProjectToolServer", () => {
	let db: Database;
	let registry: ProjectRegistry;

	beforeEach(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
		registry = new ProjectRegistry(db);
	});

	test("returns a valid SDK MCP server config", () => {
		const server = createProjectToolServer(registry);
		expect(server).toBeDefined();
		expect(server.type).toBe("sdk");
		expect(server.name).toBe("phantom-projects");
		expect(server.instance).toBeDefined();
	});

	test("register action creates a project", () => {
		registry.register("test-proj", "/tmp/test", "/tmp/test/ctx.md");
		const project = registry.get("test-proj");
		expect(project).not.toBeNull();
		expect(project?.name).toBe("test-proj");
		expect(project?.working_dir).toBe("/tmp/test");
	});

	test("list action returns registered projects", () => {
		registry.register("alpha");
		registry.register("beta");
		const projects = registry.list();
		expect(projects).toHaveLength(2);
	});

	test("activate binds session to project via registry", () => {
		const sessions = new SessionStore(db);
		sessions.create("slack", "conv-1");
		const project = registry.register("my-proj");

		registry.setSessionProject("slack:conv-1", project.id);
		expect(registry.getSessionProject("slack:conv-1")).toBe(project.id);
	});

	test("getCurrentSessionKey is passed to tool factory", () => {
		const sessionKey = "slack:conv-99";
		const server = createProjectToolServer(registry, undefined, () => sessionKey);
		expect(server).toBeDefined();
	});

	test("remove action deletes a project", () => {
		registry.register("doomed");
		expect(registry.remove("doomed")).toBe(true);
		expect(registry.get("doomed")).toBeNull();
	});

	test("info on missing project returns null", () => {
		expect(registry.get("ghost")).toBeNull();
	});
});
