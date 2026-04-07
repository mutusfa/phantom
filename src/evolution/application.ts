import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EvolutionConfig } from "./config.ts";
import type { ConfigDelta, EvolutionLogEntry, MetricsSnapshot, ValidationResult, VersionChange } from "./types.ts";

/**
 * Minimal interface for the dynamic tool registry.
 * Avoids importing the full DynamicToolRegistry to keep the evolution module self-contained.
 */
export type ToolRegistryAdapter = {
	register(params: {
		name: string;
		description: string;
		input_schema?: Record<string, unknown>;
		handler_type: "script" | "shell";
		handler_code?: string;
		handler_path?: string;
	}): void;
	unregister(name: string): boolean;
};
import { createNextVersion, readVersion, writeVersion } from "./versioning.ts";

/**
 * Apply a validated delta to the appropriate target (config file, source file, skill, or tool registry).
 * Returns the change record for version tracking.
 */
export function applyDelta(delta: ConfigDelta, config: EvolutionConfig, toolRegistry?: ToolRegistryAdapter): VersionChange {
	const domain = delta.domain ?? "config";

	// Tool registration/unregistration - no file involved
	if (delta.type === "register_tool" || delta.type === "unregister_tool") {
		return applyToolDelta(delta, toolRegistry);
	}

	// Determine base path based on domain
	let filePath: string;
	if (domain === "source") {
		filePath = join(process.cwd(), config.paths.source_dir ?? "src", delta.file);
	} else if (domain === "skill") {
		filePath = join(process.cwd(), config.paths.skills_dir ?? ".claude/skills", delta.file);
	} else {
		// "config" domain - existing behavior
		filePath = join(config.paths.config_dir, delta.file);
	}

	// Ensure directory exists
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	let currentContent = "";
	try {
		currentContent = readFileSync(filePath, "utf-8");
	} catch {
		// File doesn't exist yet
	}

	let newContent: string;

	switch (delta.type) {
		case "create_file":
			// Create fresh - does not merge with existing content
			newContent = delta.content;
			break;
		case "append":
			newContent = currentContent ? `${currentContent}\n${delta.content}` : delta.content;
			break;
		case "replace":
			if (delta.target && currentContent.includes(delta.target)) {
				newContent = currentContent.replace(delta.target, delta.content);
			} else {
				// Target not found, append instead
				newContent = currentContent ? `${currentContent}\n${delta.content}` : delta.content;
			}
			break;
		case "remove":
			if (delta.target) {
				newContent = currentContent.replace(delta.target, "").trim();
			} else {
				newContent = currentContent;
			}
			break;
		default:
			newContent = currentContent;
	}

	writeFileSync(filePath, newContent, "utf-8");

	return {
		file: delta.file,
		type: delta.type,
		content: delta.content,
		rationale: delta.rationale,
		session_ids: delta.session_ids,
		domain: delta.domain,
	};
}

/**
 * Apply a tool registration/unregistration delta via the tool registry.
 * For register_tool: delta.content is JSON with tool params.
 * For unregister_tool: delta.file is the tool name.
 */
function applyToolDelta(delta: ConfigDelta, toolRegistry?: ToolRegistryAdapter): VersionChange {
	if (!toolRegistry) {
		throw new Error(
			`Tool delta "${delta.type}" for "${delta.file}" requires a ToolRegistryAdapter but none was provided.`,
		);
	}

	if (delta.type === "register_tool") {
		let params: Parameters<ToolRegistryAdapter["register"]>[0];
		try {
			params = JSON.parse(delta.content) as Parameters<ToolRegistryAdapter["register"]>[0];
		} catch {
			throw new Error(`register_tool delta for "${delta.file}" has invalid JSON content: ${delta.content.slice(0, 100)}`);
		}
		toolRegistry.register(params);
	} else if (delta.type === "unregister_tool") {
		toolRegistry.unregister(delta.file);
	}

	return {
		file: delta.file,
		type: delta.type,
		content: delta.content,
		rationale: delta.rationale,
		session_ids: delta.session_ids,
		domain: delta.domain,
	};
}

/**
 * Apply all approved deltas, update version.json, and append to evolution-log.jsonl.
 * This is atomic: either all approved changes apply, or the version is not bumped.
 */
export function applyApproved(
	results: ValidationResult[],
	config: EvolutionConfig,
	sessionId: string,
	metricsSnapshot: MetricsSnapshot,
	toolRegistry?: ToolRegistryAdapter,
): { applied: VersionChange[]; rejected: Array<{ change: ConfigDelta; reasons: string[] }> } {
	const approved = results.filter((r) => r.approved);
	const rejected = results.filter((r) => !r.approved);

	if (approved.length === 0) {
		return {
			applied: [],
			rejected: rejected.map((r) => ({
				change: r.delta,
				reasons: r.gates.filter((g) => !g.passed).map((g) => `${g.gate}: ${g.reason}`),
			})),
		};
	}

	// Apply all approved deltas
	const appliedChanges: VersionChange[] = [];
	for (const result of approved) {
		const change = applyDelta(result.delta, config, toolRegistry);
		appliedChanges.push(change);
	}

	// Update version
	const currentVersion = readVersion(config);
	const newVersion = createNextVersion(currentVersion, appliedChanges, metricsSnapshot);
	writeVersion(config, newVersion);

	// Append to evolution log
	const logEntry: EvolutionLogEntry = {
		timestamp: new Date().toISOString(),
		version: newVersion.version,
		session_id: sessionId,
		changes_applied: appliedChanges.length,
		changes_rejected: rejected.length,
		details: appliedChanges,
	};
	appendToLog(config.paths.evolution_log, logEntry);

	return {
		applied: appliedChanges,
		rejected: rejected.map((r) => ({
			change: r.delta,
			reasons: r.gates.filter((g) => !g.passed).map((g) => `${g.gate}: ${g.reason}`),
		})),
	};
}

function appendToLog(logPath: string, entry: EvolutionLogEntry): void {
	try {
		const dir = dirname(logPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf-8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[evolution] Failed to write evolution log: ${msg}`);
	}
}
