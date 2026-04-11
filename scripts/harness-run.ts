/**
 * Harness optimization runner.
 *
 * Runs a propose-evaluate loop for a project-specific optimization task.
 * Each project defines its own manifest with working directory, env, and
 * eval command. No handler types - the eval command is always a shell command.
 *
 * Usage:
 *   bun scripts/harness-run.ts <project> <task> [--iterations N] [--target-score 0.9]
 *
 * File layout:
 *   data/harness-runs/<project>/<task>/
 *     manifest.json             task definition
 *     eval.sh                   optional eval script (referenced by manifest)
 *     candidates/
 *       v001.<ext>              candidate source
 *       v001.trace.jsonl        raw eval output as JSONL lines
 *       v001.score.json         { score, timestamp }
 *     best.json                 { version, score }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { EvolutionEngine } from "../src/evolution/engine.ts";
import type { SessionSummary } from "../src/evolution/types.ts";

type Manifest = {
	project: string;
	task: string;
	description: string;
	/** Path to the file being optimized, relative to working_dir */
	candidate_file: string;
	/** Shell command to evaluate a candidate. Exit 0 = pass.
	 *  Optionally print "SCORE: 0.82" on stdout for fractional scores. */
	eval_command: string;
	/** Absolute path to the project root */
	working_dir: string;
	/** Project-specific env vars injected into the eval subprocess */
	env?: Record<string, string>;
	/** Score threshold to stop early (0.0-1.0, default 1.0) */
	target_score?: number;
	/** Max proposal iterations (default 10) */
	max_iterations?: number;
	/** Override project evolved config root (default: data/projects/<project>/evolved/) */
	evolution_config_dir?: string;
};

type ScoreEntry = {
	score: number;
	timestamp: string;
};

type BestEntry = {
	version: string;
	score: number;
};

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const project = args[0];
	const task = args[1];

	if (!project || !task) {
		console.error("Usage: bun scripts/harness-run.ts <project> <task> [--iterations N] [--target-score 0.9]");
		process.exit(1);
	}

	let maxIterOverride: number | undefined;
	let targetScoreOverride: number | undefined;
	for (let i = 2; i < args.length; i++) {
		if (args[i] === "--iterations" && args[i + 1]) maxIterOverride = Number.parseInt(args[++i] as string);
		if (args[i] === "--target-score" && args[i + 1]) targetScoreOverride = Number.parseFloat(args[++i] as string);
	}

	const taskDir = join(process.cwd(), "data", "harness-runs", project, task);
	const manifestPath = join(taskDir, "manifest.json");

	if (!existsSync(manifestPath)) {
		console.error(`Manifest not found: ${manifestPath}`);
		process.exit(1);
	}

	const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	const targetScore = targetScoreOverride ?? manifest.target_score ?? 1.0;
	const maxIter = maxIterOverride ?? manifest.max_iterations ?? 10;
	const candidatePath = join(manifest.working_dir, manifest.candidate_file);
	const ext = manifest.candidate_file.split(".").pop() ?? "ts";
	const candidatesDir = join(taskDir, "candidates");

	// Project-level autonomous context: instructions specific to Phantom sessions,
	// separate from CLAUDE.md which is injected in all Claude Code sessions.
	const projectContextPath = join(process.cwd(), "data", "harness-runs", project, "context.md");
	const projectContext = existsSync(projectContextPath) ? readFileSync(projectContextPath, "utf-8") : null;
	if (projectContext) {
		console.log(`[harness] Loaded project context (${projectContextPath})`);
	}

	if (!existsSync(candidatePath)) {
		console.error(`Candidate file not found: ${candidatePath}`);
		process.exit(1);
	}

	mkdirSync(candidatesDir, { recursive: true });

	console.log(`\n[harness] ${manifest.project} / ${manifest.task}`);
	console.log(`[harness] ${manifest.description}`);
	console.log(`[harness] target=${targetScore} max_iterations=${maxIter}\n`);

	// Snapshot current best from best.json, or establish baseline from v001
	let versionNum = nextVersionNum(candidatesDir, ext);

	if (versionNum === 1) {
		// No candidates yet - baseline the current file as v001
		const baseline = readFileSync(candidatePath, "utf-8");
		const vStr = padVer(1);
		writeFileSync(join(candidatesDir, `${vStr}.${ext}`), baseline);

		console.log(`[harness] Evaluating baseline (${vStr})...`);
		const { score, output } = await runEval(manifest, taskDir);
		writeTrace(candidatesDir, vStr, output);
		writeScore(candidatesDir, vStr, score);
		writeBestIfBetter(taskDir, vStr, score);
		console.log(`[harness] ${vStr} baseline: score=${score.toFixed(3)}\n`);
		versionNum = 2;
	}

	// Main propose-evaluate loop
	for (let iter = versionNum; iter <= maxIter + 1; iter++) {
		const best = readBest(taskDir);
		if (!best) {
			console.error("[harness] best.json missing, cannot continue");
			process.exit(1);
		}

		if (best.score >= targetScore) {
			console.log(`[harness] Target score ${targetScore} reached at ${best.version}. Done.`);
			break;
		}

		if (iter > maxIter + 1) {
			console.log(`[harness] Max iterations reached. Best: ${best.version} (${best.score.toFixed(3)})`);
			break;
		}

		const vStr = padVer(iter);
		console.log(`[harness] Proposing ${vStr} (best=${best.version} score=${best.score.toFixed(3)})...`);

		const proposerPrompt = buildProposerPrompt(manifest, taskDir, candidatesDir, best, ext);
		const candidate = await runProposer(proposerPrompt, manifest.working_dir, projectContext);

		if (!candidate.trim()) {
			console.error("[harness] Proposer returned empty response, stopping");
			break;
		}

		writeFileSync(join(candidatesDir, `${vStr}.${ext}`), candidate);

		// Apply candidate, evaluate, then always restore original
		const original = readFileSync(candidatePath, "utf-8");
		writeFileSync(candidatePath, candidate);

		let score = 0;
		let output = "";
		try {
			const result = await runEval(manifest, taskDir);
			score = result.score;
			output = result.output;
		} finally {
			writeFileSync(candidatePath, original);
		}

		writeTrace(candidatesDir, vStr, output);
		writeScore(candidatesDir, vStr, score);
		writeBestIfBetter(taskDir, vStr, score);

		const newBest = readBest(taskDir) as BestEntry;
		console.log(
			`[harness] ${vStr}: score=${score.toFixed(3)} | best=${newBest.version} (${newBest.score.toFixed(3)})\n`,
		);
	}

	const final = readBest(taskDir);
	if (final) {
		console.log(`\n[harness] Finished. Best: ${final.version} score=${final.score.toFixed(3)}`);
		if (final.score < targetScore) {
			console.log(`[harness] Target ${targetScore} not reached. Apply manually from:`);
			console.log(`[harness]   ${join(candidatesDir, `${final.version}.${ext}`)}`);
		}
	}

	const evoRoot = manifest.evolution_config_dir ?? join(process.cwd(), "data", "projects", project, "evolved");
	const bestTracePath = final ? join(candidatesDir, `${final.version}.trace.jsonl`) : "";
	const bestTrace =
		bestTracePath && existsSync(bestTracePath) ? readFileSync(bestTracePath, "utf-8").slice(0, 12_000) : "(no trace)";
	const harnessSummary: SessionSummary = {
		session_id: `harness-${project}-${task}-${Date.now()}`,
		session_key: `harness:${project}:${task}`,
		user_id: "harness",
		user_messages: [`${manifest.description} (harness task ${task})`],
		assistant_messages: [
			final
				? `Best candidate ${final.version} score=${final.score.toFixed(3)}.\n\nEval trace excerpt:\n${bestTrace}`
				: "Harness finished without a recorded best candidate.",
		],
		tools_used: [],
		files_tracked: [candidatePath],
		outcome: final && final.score > 0 ? "success" : "partial",
		cost_usd: 0,
		started_at: new Date().toISOString(),
		ended_at: new Date().toISOString(),
		project_evolution_config_dir: evoRoot,
		bypass_cadence: true,
	};

	console.log("\n[harness] Running project-scoped evolution...");
	try {
		const engine = new EvolutionEngine();
		const evoResult = await engine.afterSession(harnessSummary);
		console.log(
			`[harness] Project evolution done: version=${evoResult.version} applied=${evoResult.changes_applied.length} rejected=${evoResult.changes_rejected.length}`,
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[harness] Project evolution failed: ${msg}`);
	}
}

function buildProposerPrompt(
	manifest: Manifest,
	taskDir: string,
	candidatesDir: string,
	best: BestEntry,
	ext: string,
): string {
	// Build score history
	const scoreHistory: string[] = [];
	let v = 1;
	while (true) {
		const vStr = padVer(v);
		const scorePath = join(candidatesDir, `${vStr}.score.json`);
		if (!existsSync(scorePath)) break;
		const s: ScoreEntry = JSON.parse(readFileSync(scorePath, "utf-8"));
		scoreHistory.push(`  ${vStr}: score=${s.score.toFixed(3)}`);
		v++;
	}

	const bestSrc = readFileSync(join(candidatesDir, `${best.version}.${ext}`), "utf-8");

	const bestTracePath = join(candidatesDir, `${best.version}.trace.jsonl`);
	const bestTrace = existsSync(bestTracePath)
		? readFileSync(bestTracePath, "utf-8")
				.split("\n")
				.slice(0, 100) // cap at 100 lines to avoid bloating the prompt
				.join("\n")
		: "(no trace available)";

	return `# Code Optimization Task

**Project:** ${manifest.project}
**Task:** ${manifest.task}
**Goal:** ${manifest.description}

## Optimization History
${scoreHistory.join("\n") || "  (no history yet)"}

## Best Version: ${best.version} (score=${best.score.toFixed(3)})

### Source
\`\`\`${ext}
${bestSrc}
\`\`\`

### Execution Trace
\`\`\`
${bestTrace}
\`\`\`

## Protocol

Before proposing any change:
1. Read the execution trace above to find what is failing or missing
2. Identify the specific code path responsible
3. Form a hypothesis: "This fails because..."
4. Write the smallest targeted change that addresses the hypothesis

**Output only the complete improved file content. No markdown fences, no explanation.**`;
}

async function runProposer(prompt: string, workingDir: string, projectContext: string | null): Promise<string> {
	let result = "";

	const baseInstruction =
		"You are a code optimization proposer in a harness loop. " +
		"Read the execution trace, diagnose the failure, then output only the improved file content. " +
		"No markdown, no explanation - just the raw file.";
	const systemAppend = projectContext
		? `${baseInstruction}\n\n# Project Context\n\n${projectContext}`
		: baseInstruction;

	const queryStream = query({
		prompt,
		options: {
			model: "claude-opus-4-6",
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			cwd: workingDir,
			systemPrompt: {
				type: "preset" as const,
				preset: "claude_code" as const,
				append: systemAppend,
			},
		},
	});

	for await (const message of queryStream) {
		if (message.type === "result" && message.subtype === "success") {
			result = message.result;
		}
	}

	return result.trim();
}

async function runEval(manifest: Manifest, taskDir: string): Promise<{ score: number; output: string }> {
	// Project env layered on top of a minimal safe base
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
		HOME: process.env.HOME ?? "/tmp",
		LANG: process.env.LANG ?? "en_US.UTF-8",
		TERM: "xterm-256color",
		HARNESS_TASK_DIR: taskDir,
		...manifest.env,
	};

	const proc = Bun.spawn(["bash", "-c", manifest.eval_command], {
		cwd: manifest.working_dir,
		stdout: "pipe",
		stderr: "pipe",
		env,
	});

	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;

	const combined = stderr ? `${stdout}\nSTDERR:\n${stderr}` : stdout;

	if (exitCode !== 0) {
		return { score: 0.0, output: combined };
	}

	// Optional fractional score: print "SCORE: 0.82" anywhere in stdout
	const scoreMatch = combined.match(/SCORE:\s*([\d.]+)/i);
	if (scoreMatch?.[1]) {
		return { score: Math.min(1.0, Math.max(0.0, Number.parseFloat(scoreMatch[1]))), output: combined };
	}

	return { score: 1.0, output: combined };
}

// --- Filesystem helpers ---

function nextVersionNum(candidatesDir: string, ext: string): number {
	let v = 1;
	while (existsSync(join(candidatesDir, `${padVer(v)}.${ext}`))) v++;
	return v;
}

function padVer(n: number): string {
	return `v${String(n).padStart(3, "0")}`;
}

function writeTrace(candidatesDir: string, vStr: string, output: string): void {
	const lines = output
		.split("\n")
		.map((text, i) => JSON.stringify({ type: "output", seq: i, text }))
		.join("\n");
	writeFileSync(join(candidatesDir, `${vStr}.trace.jsonl`), lines);
}

function writeScore(candidatesDir: string, vStr: string, score: number): void {
	const entry: ScoreEntry = { score, timestamp: new Date().toISOString() };
	writeFileSync(join(candidatesDir, `${vStr}.score.json`), JSON.stringify(entry, null, 2));
}

function writeBestIfBetter(taskDir: string, vStr: string, score: number): void {
	const bestPath = join(taskDir, "best.json");
	const current: BestEntry = existsSync(bestPath)
		? JSON.parse(readFileSync(bestPath, "utf-8"))
		: { version: "v000", score: -1 };
	if (score > current.score) {
		writeFileSync(bestPath, JSON.stringify({ version: vStr, score } satisfies BestEntry, null, 2));
	}
}

function readBest(taskDir: string): BestEntry | null {
	const p = join(taskDir, "best.json");
	return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`[harness] Fatal: ${msg}`);
	process.exit(1);
});
