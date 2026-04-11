import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { defaultEvolutionConfigDir, resolveContextPathForRegister } from "./paths.ts";
import type { Project } from "./types.ts";

export class ProjectRegistry {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	register(name: string, workingDir?: string, contextPath?: string, evolutionConfigDir?: string): Project {
		const cwd = process.cwd();
		const resolvedContext = resolveContextPathForRegister(cwd, name, contextPath);
		const resolvedEvolution = evolutionConfigDir ?? defaultEvolutionConfigDir(cwd, name);
		this.db.run("INSERT INTO projects (name, working_dir, context_path, evolution_config_dir) VALUES (?, ?, ?, ?)", [
			name,
			workingDir ?? null,
			resolvedContext,
			resolvedEvolution,
		]);
		return this.get(name) as Project;
	}

	get(name: string): Project | null {
		return this.db.query("SELECT * FROM projects WHERE name = ?").get(name) as Project | null;
	}

	getById(id: number): Project | null {
		return this.db.query("SELECT * FROM projects WHERE id = ?").get(id) as Project | null;
	}

	list(): Project[] {
		return this.db.query("SELECT * FROM projects ORDER BY name").all() as Project[];
	}

	update(
		name: string,
		fields: { working_dir?: string; context_path?: string; evolution_config_dir?: string },
	): Project {
		const existing = this.get(name);
		if (!existing) throw new Error(`Project '${name}' not found`);

		const setClauses: string[] = ["updated_at = datetime('now')"];
		const values: (string | null)[] = [];

		if (fields.working_dir !== undefined) {
			setClauses.push("working_dir = ?");
			values.push(fields.working_dir);
		}
		if (fields.context_path !== undefined) {
			setClauses.push("context_path = ?");
			values.push(fields.context_path);
		}
		if (fields.evolution_config_dir !== undefined) {
			setClauses.push("evolution_config_dir = ?");
			values.push(fields.evolution_config_dir);
		}

		values.push(name);
		this.db.run(`UPDATE projects SET ${setClauses.join(", ")} WHERE name = ?`, values);
		return this.get(name) as Project;
	}

	remove(name: string): boolean {
		const result = this.db.run("DELETE FROM projects WHERE name = ?", [name]);
		return result.changes > 0;
	}

	/** Bind a session to a project. */
	setSessionProject(sessionKey: string, projectId: number): void {
		this.db.run("UPDATE sessions SET project_id = ? WHERE session_key = ?", [projectId, sessionKey]);
	}

	/** Get the project_id bound to a session, or null. */
	getSessionProject(sessionKey: string): number | null {
		const row = this.db.query("SELECT project_id FROM sessions WHERE session_key = ?").get(sessionKey) as {
			project_id: number | null;
		} | null;
		return row?.project_id ?? null;
	}

	/** Remove the project binding from a session. */
	clearSessionProject(sessionKey: string): void {
		this.db.run("UPDATE sessions SET project_id = NULL WHERE session_key = ?", [sessionKey]);
	}

	/** Read the project's context file and return its contents, or null if unavailable. */
	loadContext(project: Project): string | null {
		if (!project.context_path) return null;
		try {
			return readFileSync(project.context_path, "utf-8").trim() || null;
		} catch {
			return null;
		}
	}
}
