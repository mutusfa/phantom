import { describe, expect, mock, test } from "bun:test";
import type { MemoryConfig } from "../../config/types.ts";
import { MEMORY_CONTEXT_CHARS_PER_TOKEN, MemoryContextBuilder } from "../context-builder.ts";
import type { MemorySystem } from "../system.ts";

const TEST_CONFIG: MemoryConfig = {
	qdrant: { url: "http://localhost:6333" },
	ollama: { url: "http://localhost:11434", model: "nomic-embed-text" },
	collections: { episodes: "episodes", semantic_facts: "semantic_facts", procedures: "procedures" },
	embedding: { dimensions: 768, batch_size: 32 },
	context: { max_tokens: 8000, episode_limit: 4, fact_limit: 8, procedure_limit: 2, episode_min_score: 0.3, fact_min_score: 0.45 },
};

function createMockMemorySystem(overrides?: {
	ready?: boolean;
	episodes?: ReturnType<MemorySystem["recallEpisodes"]>;
	facts?: ReturnType<MemorySystem["recallFacts"]>;
	procedure?: ReturnType<MemorySystem["findProcedure"]>;
}): MemorySystem {
	const ms = {
		isReady: () => overrides?.ready ?? true,
		recallEpisodes: mock(() => overrides?.episodes ?? Promise.resolve([])),
		recallFacts: mock(() => overrides?.facts ?? Promise.resolve([])),
		findProcedure: mock(() => overrides?.procedure ?? Promise.resolve(null)),
	} as unknown as MemorySystem;
	return ms;
}

describe("MemoryContextBuilder", () => {
	test("returns empty context when memory system is not ready", async () => {
		const memory = createMockMemorySystem({ ready: false });
		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);

		const result = await builder.build("test query");
		expect(result.context).toBe("");
		expect(result.recalledEpisodeIds).toEqual([]);
		expect(result.recalledFactIds).toEqual([]);
		expect(result.recalledTokenEstimate).toBe(0);
	});

	test("returns empty context when no memories found", async () => {
		const memory = createMockMemorySystem();
		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);

		const result = await builder.build("test query");
		expect(result.context).toBe("");
	});

	test("formats facts section correctly and records fact ids", async () => {
		const memory = createMockMemorySystem({
			facts: Promise.resolve([
				{
					id: "f1",
					subject: "staging",
					predicate: "runs on",
					object: "port 3001",
					natural_language: "The staging server runs on port 3001",
					source_episode_ids: [],
					confidence: 0.9,
					valid_from: new Date().toISOString(),
					valid_until: null,
					version: 1,
					previous_version_id: null,
					category: "domain_knowledge" as const,
					tags: [],
				},
				{
					id: "f2",
					subject: "user",
					predicate: "prefers",
					object: "PRs over direct pushes",
					natural_language: "Cheema prefers PRs over direct pushes",
					source_episode_ids: [],
					confidence: 0.8,
					valid_from: new Date().toISOString(),
					valid_until: null,
					version: 1,
					previous_version_id: null,
					category: "user_preference" as const,
					tags: [],
				},
			]),
		});

		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		const result = await builder.build("test query");

		expect(result.context).toContain("## Known Facts");
		expect(result.context).toContain("staging server runs on port 3001");
		expect(result.context).toContain("PRs over direct pushes");
		expect(result.context).toContain("[confidence: 0.9]");
		expect(result.recalledFactIds).toEqual(["f1", "f2"]);
		expect(result.recalledEpisodeIds).toEqual([]);
		expect(result.recalledTokenEstimate).toBe(Math.ceil(result.context.length / MEMORY_CONTEXT_CHARS_PER_TOKEN));
	});

	test("formats episodes section correctly and records episode ids", async () => {
		const memory = createMockMemorySystem({
			episodes: Promise.resolve([
				{
					id: "ep1",
					type: "task" as const,
					summary: "Deployed the staging server",
					detail: "Full detail",
					parent_id: null,
					session_id: "s1",
					user_id: "u1",
					tools_used: ["Bash"],
					files_touched: [],
					outcome: "success" as const,
					outcome_detail: "",
					lessons: [],
					started_at: new Date(Date.now() - 3600000).toISOString(),
					ended_at: new Date().toISOString(),
					duration_seconds: 3600,
					importance: 0.8,
					access_count: 0,
					last_accessed_at: "",
					decay_rate: 1.0,
				},
			]),
		});

		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		const result = await builder.build("test query");

		expect(result.context).toContain("## Recent Memories");
		expect(result.context).toContain("[task]");
		expect(result.context).toContain("Deployed the staging server");
		expect(result.context).toContain("success");
		expect(result.recalledEpisodeIds).toEqual(["ep1"]);
	});

	test("filters stale low-signal episodes from prompt context", async () => {
		const memory = createMockMemorySystem({
			episodes: Promise.resolve([
				{
					id: "stale-ep",
					type: "task" as const,
					summary: "One-off stale note",
					detail: "No longer important",
					parent_id: null,
					session_id: "s1",
					user_id: "u1",
					tools_used: [],
					files_touched: [],
					outcome: "success" as const,
					outcome_detail: "",
					lessons: [],
					started_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
					ended_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
					duration_seconds: 300,
					importance: 0.2,
					access_count: 0,
					last_accessed_at: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
					decay_rate: 1.0,
				},
				{
					id: "durable-ep",
					type: "task" as const,
					summary: "Repeated deployment pattern",
					detail: "Still referenced often",
					parent_id: null,
					session_id: "s2",
					user_id: "u1",
					tools_used: ["Bash"],
					files_touched: [],
					outcome: "success" as const,
					outcome_detail: "",
					lessons: [],
					started_at: new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString(),
					ended_at: new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString(),
					duration_seconds: 300,
					importance: 0.8,
					access_count: 4,
					last_accessed_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
					decay_rate: 1.0,
				},
			]),
		});

		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		const result = await builder.build("deployment");

		expect(result.context).toContain("Repeated deployment pattern");
		expect(result.context).not.toContain("One-off stale note");
		expect(result.recalledEpisodeIds).toEqual(["durable-ep"]);
	});

	test("formats procedure section correctly", async () => {
		const memory = createMockMemorySystem({
			procedure: Promise.resolve({
				id: "proc1",
				name: "deploy_staging",
				description: "Deploy to staging environment",
				trigger: "User asks to deploy to staging",
				steps: [
					{
						order: 1,
						action: "Run tests",
						tool: "Bash",
						expected_outcome: "All pass",
						error_handling: null,
						decision_point: false,
					},
					{
						order: 2,
						action: "Create PR",
						tool: "Bash",
						expected_outcome: "PR created",
						error_handling: null,
						decision_point: false,
					},
				],
				preconditions: [],
				postconditions: [],
				parameters: {},
				source_episode_ids: [],
				success_count: 5,
				failure_count: 1,
				last_used_at: new Date().toISOString(),
				confidence: 0.8,
				version: 1,
			}),
		});

		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		const result = await builder.build("deploy to staging");

		expect(result.context).toContain("## Relevant Procedure: deploy_staging");
		expect(result.context).toContain("1. Run tests");
		expect(result.context).toContain("2. Create PR");
		expect(result.context).toContain("5 successes");
	});

	test("respects token budget and truncates", async () => {
		// Create many facts that would exceed a tiny budget
		const manyFacts = Array.from({ length: 100 }, (_, i) => ({
			id: `f${i}`,
			subject: `subject-${i}`,
			predicate: "is",
			object: `a very long description that takes up many tokens for fact number ${i}`,
			natural_language: `Subject ${i} is a very long description that takes up many tokens for fact number ${i} with lots of extra text to make it really long`,
			source_episode_ids: [],
			confidence: 0.9,
			valid_from: new Date().toISOString(),
			valid_until: null,
			version: 1,
			previous_version_id: null,
			category: "domain_knowledge" as const,
			tags: [],
		}));

		const memory = createMockMemorySystem({
			facts: Promise.resolve(manyFacts),
		});

		const smallConfig = { ...TEST_CONFIG, context: { ...TEST_CONFIG.context, max_tokens: 100 } };
		const builder = new MemoryContextBuilder(memory, smallConfig);
		const result = await builder.build("test");

		// Whole fact block exceeds budget, so builder omits recall entirely
		expect(result.context).toBe("");
		const estimatedTokens = Math.ceil(result.context.length / MEMORY_CONTEXT_CHARS_PER_TOKEN);
		expect(estimatedTokens).toBeLessThan(200);
	});

	test("handles errors from memory system gracefully", async () => {
		const memory = createMockMemorySystem({
			episodes: Promise.reject(new Error("Qdrant down")),
			facts: Promise.reject(new Error("Qdrant down")),
			procedure: Promise.reject(new Error("Qdrant down")),
		});

		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		const result = await builder.build("test");

		// Should not throw, just return empty
		expect(result.context).toBe("");
	});

	test("passes episode_min_score and fact_min_score from config to recall calls", async () => {
		const memory = createMockMemorySystem();
		const config: MemoryConfig = {
			...TEST_CONFIG,
			context: { ...TEST_CONFIG.context, episode_min_score: 0.6, fact_min_score: 0.7 },
		};
		const builder = new MemoryContextBuilder(memory, config);
		await builder.build("test query");

		const episodeMock = (memory.recallEpisodes as ReturnType<typeof mock>);
		const factMock = (memory.recallFacts as ReturnType<typeof mock>);

		expect(episodeMock.mock.calls[0][1]).toMatchObject({ minScore: 0.6 });
		expect(factMock.mock.calls[0][1]).toMatchObject({ minScore: 0.7 });
	});

	test("uses default thresholds from config when not overridden", async () => {
		const memory = createMockMemorySystem();
		const builder = new MemoryContextBuilder(memory, TEST_CONFIG);
		await builder.build("test query");

		const episodeMock = (memory.recallEpisodes as ReturnType<typeof mock>);
		const factMock = (memory.recallFacts as ReturnType<typeof mock>);

		expect(episodeMock.mock.calls[0][1]).toMatchObject({ minScore: 0.3 });
		expect(factMock.mock.calls[0][1]).toMatchObject({ minScore: 0.45 });
	});
});
