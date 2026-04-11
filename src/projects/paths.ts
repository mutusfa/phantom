import { existsSync } from "node:fs";
import { join } from "node:path";

/** Default markdown context file under data/projects/<name>/. */
export function defaultProjectContextPath(cwd: string, name: string): string {
	return join(cwd, "data", "projects", name, "context.md");
}

/** Harness convention: data/harness-runs/<name>/context.md */
export function harnessProjectContextPath(cwd: string, name: string): string {
	return join(cwd, "data", "harness-runs", name, "context.md");
}

/** Default evolved config tree for a named project. */
export function defaultEvolutionConfigDir(cwd: string, name: string): string {
	return join(cwd, "data", "projects", name, "evolved");
}

/**
 * If the caller did not pass an explicit path, prefer an existing harness context.md;
 * otherwise use data/projects/<name>/context.md.
 */
export function resolveContextPathForRegister(cwd: string, name: string, explicitContextPath?: string): string {
	if (explicitContextPath !== undefined) {
		return explicitContextPath;
	}
	const harness = harnessProjectContextPath(cwd, name);
	if (existsSync(harness)) {
		return harness;
	}
	return defaultProjectContextPath(cwd, name);
}
