import type { MemoryConfig } from "../config/types.ts";
import { shouldIncludeEpisodeInContext } from "./ranking.ts";
import type { MemorySystem } from "./system.ts";
import type { Episode, Procedure, SemanticFact } from "./types.ts";

/** Slightly conservative vs chars/4 so budgeting stays under max_tokens. */
export const MEMORY_CONTEXT_CHARS_PER_TOKEN = 3.2;

export type MemoryContextBuildResult = {
	context: string;
	recalledEpisodeIds: string[];
	recalledFactIds: string[];
	recalledTokenEstimate: number;
};

export class MemoryContextBuilder {
	private memory: MemorySystem;
	private maxTokens: number;
	private episodeLimit: number;
	private factLimit: number;
	private episodeMinScore: number;
	private factMinScore: number;

	constructor(memory: MemorySystem, config: MemoryConfig) {
		this.memory = memory;
		this.maxTokens = config.context.max_tokens;
		this.episodeLimit = config.context.episode_limit;
		this.factLimit = config.context.fact_limit;
		this.episodeMinScore = config.context.episode_min_score;
		this.factMinScore = config.context.fact_min_score;
	}

	async build(query: string): Promise<MemoryContextBuildResult> {
		const empty: MemoryContextBuildResult = {
			context: "",
			recalledEpisodeIds: [],
			recalledFactIds: [],
			recalledTokenEstimate: 0,
		};

		if (!this.memory.isReady()) {
			return empty;
		}

		const [episodes, facts, procedure] = await Promise.all([
			this.memory.recallEpisodes(query, { limit: this.episodeLimit, minScore: this.episodeMinScore }).catch(() => []),
			this.memory.recallFacts(query, { limit: this.factLimit, minScore: this.factMinScore }).catch(() => []),
			this.memory.findProcedure(query).catch(() => null),
		]);

		const sections: string[] = [];
		let tokenBudget = this.maxTokens;
		let recalledFactIds: string[] = [];
		let recalledEpisodeIds: string[] = [];

		// Known facts get priority - they're the agent's accumulated knowledge
		if (facts.length > 0) {
			const factSection = this.formatFacts(facts);
			const factTokens = this.estimateTokens(factSection);
			if (factTokens <= tokenBudget) {
				sections.push(factSection);
				tokenBudget -= factTokens;
				recalledFactIds = facts.map((f) => f.id);
			}
		}

		// Recent memories provide episode context
		if (episodes.length > 0 && tokenBudget > 500) {
			const durableEpisodes = episodes.filter(shouldIncludeEpisodeInContext);
			const { text: episodeSection, includedIds } = this.formatEpisodes(durableEpisodes, tokenBudget);
			const episodeTokens = this.estimateTokens(episodeSection);
			if (episodeSection) {
				sections.push(episodeSection);
				tokenBudget -= episodeTokens;
				recalledEpisodeIds = includedIds;
			}
		}

		// Relevant procedures
		if (procedure && tokenBudget > 200) {
			const procSection = this.formatProcedure(procedure);
			const procTokens = this.estimateTokens(procSection);
			if (procTokens <= tokenBudget) {
				sections.push(procSection);
			}
		}

		if (sections.length === 0) return empty;

		const context = sections.join("\n\n");
		return {
			context,
			recalledEpisodeIds,
			recalledFactIds,
			recalledTokenEstimate: this.estimateTokens(context),
		};
	}

	private formatFacts(facts: SemanticFact[]): string {
		const lines = facts.map((f) => `- ${f.natural_language} [confidence: ${f.confidence.toFixed(1)}]`);
		return `## Known Facts\n${lines.join("\n")}`;
	}

	private formatEpisodes(episodes: Episode[], tokenBudget: number): { text: string; includedIds: string[] } {
		if (episodes.length === 0) return { text: "", includedIds: [] };

		const header = "## Recent Memories\n";
		let content = header;
		const includedIds: string[] = [];
		const maxChars = tokenBudget * MEMORY_CONTEXT_CHARS_PER_TOKEN;

		for (const ep of episodes) {
			const entry = `- [${ep.type}] ${ep.summary} (${ep.outcome}, ${formatRelativeTime(ep.started_at)})\n`;

			if (content.length + entry.length > maxChars) break;
			content += entry;
			includedIds.push(ep.id);
		}

		return { text: content.trim(), includedIds };
	}

	private formatProcedure(procedure: Procedure): string {
		const steps = procedure.steps.map((s) => `  ${s.order}. ${s.action}`).join("\n");

		return (
			`## Relevant Procedure: ${procedure.name}\n` +
			`Trigger: ${procedure.trigger}\n` +
			`Confidence: ${procedure.confidence.toFixed(1)} ` +
			`(${procedure.success_count} successes, ${procedure.failure_count} failures)\n` +
			`Steps:\n${steps}`
		);
	}

	private estimateTokens(text: string): number {
		return Math.ceil(text.length / MEMORY_CONTEXT_CHARS_PER_TOKEN);
	}
}

function formatRelativeTime(isoDate: string): string {
	if (!isoDate) return "unknown";

	const diff = Date.now() - new Date(isoDate).getTime();
	const hours = Math.floor(diff / (1000 * 60 * 60));

	if (hours < 1) return "just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	return `${weeks}w ago`;
}
