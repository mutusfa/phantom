import type { EvolutionEngine } from "../evolution/engine.ts";
import type { EvolvedConfig } from "../evolution/types.ts";
import { mergeEvolvedConfigs } from "../evolution/types.ts";
import type { ProjectRegistry } from "./registry.ts";
import type { Project } from "./types.ts";

/** Optional explicit project binding for channels without a stored session row (MCP, trigger, scheduler). */
export type ProjectBindingInput = {
	projectName?: string;
	projectId?: number;
};

export type ResolvedProjectSession = {
	sessionKey: string;
	projectOptions: { context?: string; cwd?: string } | undefined;
	/**
	 * Merged global + project evolved config for this query. Null means leave runtime evolved config unchanged
	 * (no project, or no evolution engine, or project has no evolution_config_dir).
	 */
	mergedEvolvedForQuery: EvolvedConfig | null;
	/** Set on SessionSummary when running project-scoped evolution after this query. */
	projectEvolutionConfigDir: string | null;
	/** Resolved project row, if any. */
	project: Project | null;
};

/**
 * Resolve cwd, context markdown, merged evolved prompt, and evolution root for one agent query.
 * Precedence: explicit projectId, then explicit projectName, then sessions.project_id for sessionKey.
 */
export function resolveProjectForQuery(
	registry: ProjectRegistry,
	evolution: EvolutionEngine | null,
	channelId: string,
	conversationId: string,
	explicit?: ProjectBindingInput,
): ResolvedProjectSession {
	const sessionKey = `${channelId}:${conversationId}`;
	let project: Project | null = null;
	if (explicit?.projectId != null) {
		project = registry.getById(explicit.projectId);
	} else if (explicit?.projectName != null && explicit.projectName.length > 0) {
		project = registry.get(explicit.projectName);
	} else {
		const pid = registry.getSessionProject(sessionKey);
		if (pid != null) {
			project = registry.getById(pid);
		}
	}

	if (!project) {
		return {
			sessionKey,
			projectOptions: undefined,
			mergedEvolvedForQuery: null,
			projectEvolutionConfigDir: null,
			project: null,
		};
	}

	const ctx = registry.loadContext(project);
	const opts: { context?: string; cwd?: string } = {
		...(ctx ? { context: ctx } : {}),
		...(project.working_dir ? { cwd: project.working_dir } : {}),
	};
	const projectOptions = Object.keys(opts).length > 0 ? opts : undefined;

	let mergedEvolvedForQuery: EvolvedConfig | null = null;
	let projectEvolutionConfigDir: string | null = null;
	if (evolution && project.evolution_config_dir) {
		projectEvolutionConfigDir = project.evolution_config_dir;
		mergedEvolvedForQuery = mergeEvolvedConfigs(
			evolution.getConfig(),
			evolution.getProjectConfig(project.evolution_config_dir),
		);
	}

	return {
		sessionKey,
		projectOptions,
		mergedEvolvedForQuery,
		projectEvolutionConfigDir,
		project,
	};
}
