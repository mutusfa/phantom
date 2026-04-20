/**
 * One-shot diagnostic: sizes each slice of the Agent SDK `append` system prompt
 * (preset `claude_code` + append). Does not call the API.
 *
 * Default scenario matches a new Slack or web session: env snapshot on, role
 * YAML from phantom.yaml `role`, evolved markdown from evolution paths,
 * synthetic vector-recall text sized to `config/memory.yaml` context.max_tokens
 * using the same chars-per-token heuristic as MemoryContextBuilder (3.2).
 *
 * Usage (from repo root):
 *   bun scripts/dump-prompt-size.ts
 *   bun scripts/dump-prompt-size.ts --config /path/to/phantom.yaml
 *   bun scripts/dump-prompt-size.ts --memory-mode empty
 *   bun scripts/dump-prompt-size.ts --memory-file ./samples/recall.txt
 *   bun scripts/dump-prompt-size.ts --no-snapshot --no-evolved
 *
 * Flags:
 *   --config PATH          phantom.yaml (default: config/phantom.yaml)
 *   --memory-yaml PATH     memory.yaml (default: config/memory.yaml)
 *   --evolution-yaml PATH  evolution.yaml for paths.config_dir (default: config/evolution.yaml)
 *   --roles-dir PATH       role YAML directory (default: config/roles)
 *   --no-role              Use fallback role line instead of loading role YAML
 *   --no-evolved           Skip phantom-config markdown
 *   --no-snapshot          Omit session_state (simulates resumed SDK session)
 *   --memory-mode empty|max   Recall body: none, or synthetic chars = max_tokens*3.2 (default: max)
 *   --memory-file PATH     Use file contents as recall body (overrides memory-mode)
 *   --project-file PATH    Append active_project section from file body
 *   --data-dir PATH        Override working memory directory (default: ./data)
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatEnvSnapshot, gatherEnvSnapshot } from "../src/agent/env-snapshot.ts";
import { collectPromptAssemblySections } from "../src/agent/prompt-assembler.ts";
import { loadConfig } from "../src/config/loader.ts";
import { loadEvolutionConfig } from "../src/evolution/config.ts";
import type { EvolvedConfig } from "../src/evolution/types.ts";
import { loadMemoryConfig } from "../src/memory/config.ts";
import { MEMORY_CONTEXT_CHARS_PER_TOKEN } from "../src/memory/context-builder.ts";
import { loadRoleFromYaml } from "../src/roles/loader.ts";

// Matches MemoryContextBuilder: rough token estimate used for budgeting.
const CHARS_PER_TOKEN = MEMORY_CONTEXT_CHARS_PER_TOKEN;

type MemoryMode = "empty" | "max";

type CliOptions = {
	configPath: string;
	memoryYamlPath: string;
	evolutionYamlPath: string;
	rolesDir: string;
	useRoleYaml: boolean;
	includeEvolved: boolean;
	includeSnapshot: boolean;
	memoryMode: MemoryMode;
	memoryFile?: string;
	projectFile?: string;
	dataDir?: string;
};

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {
		configPath: "config/phantom.yaml",
		memoryYamlPath: "config/memory.yaml",
		evolutionYamlPath: "config/evolution.yaml",
		rolesDir: "config/roles",
		useRoleYaml: true,
		includeEvolved: true,
		includeSnapshot: true,
		memoryMode: "max",
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--config" && argv[i + 1]) {
			opts.configPath = argv[++i] ?? opts.configPath;
		} else if (a === "--memory-yaml" && argv[i + 1]) {
			opts.memoryYamlPath = argv[++i] ?? opts.memoryYamlPath;
		} else if (a === "--evolution-yaml" && argv[i + 1]) {
			opts.evolutionYamlPath = argv[++i] ?? opts.evolutionYamlPath;
		} else if (a === "--roles-dir" && argv[i + 1]) {
			opts.rolesDir = argv[++i] ?? opts.rolesDir;
		} else if (a === "--no-role") {
			opts.useRoleYaml = false;
		} else if (a === "--no-evolved") {
			opts.includeEvolved = false;
		} else if (a === "--no-snapshot") {
			opts.includeSnapshot = false;
		} else if (a === "--memory-mode" && argv[i + 1]) {
			const m = argv[++i];
			if (m === "empty" || m === "max") {
				opts.memoryMode = m;
			} else {
				throw new Error(`--memory-mode must be empty or max, got: ${m}`);
			}
		} else if (a === "--memory-file" && argv[i + 1]) {
			opts.memoryFile = argv[++i];
		} else if (a === "--project-file" && argv[i + 1]) {
			opts.projectFile = argv[++i];
		} else if (a === "--data-dir" && argv[i + 1]) {
			opts.dataDir = argv[++i];
		} else if (a === "--help" || a === "-h") {
			console.log(`Usage: bun scripts/dump-prompt-size.ts [flags]
See file header in scripts/dump-prompt-size.ts for options.`);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}

	return opts;
}

function readOptionalFile(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

function resolveConfigDir(evolutionPathsConfigDir: string): string {
	if (evolutionPathsConfigDir.startsWith("/")) {
		return evolutionPathsConfigDir;
	}
	return resolve(process.cwd(), evolutionPathsConfigDir);
}

function loadEvolvedForDump(configDir: string): EvolvedConfig {
	const read = (rel: string): string => readOptionalFile(join(configDir, rel));
	return {
		constitution: read("constitution.md"),
		persona: read("persona.md"),
		userProfile: read("user-profile.md"),
		domainKnowledge: read("domain-knowledge.md"),
		strategies: {
			taskPatterns: read("strategies/task-patterns.md"),
			toolPreferences: read("strategies/tool-preferences.md"),
			errorRecovery: read("strategies/error-recovery.md"),
		},
		meta: {
			version: 0,
			metricsSnapshot: { session_count: 0, success_rate_7d: 0 },
		},
	};
}

function syntheticRecallBody(targetChars: number): string {
	const header = "## Synthetic vector recall (placeholder bytes)\n\n";
	if (targetChars <= header.length) {
		return header.slice(0, Math.max(0, targetChars));
	}
	const padLen = targetChars - header.length;
	const unit = "tok4 ";
	const body = unit.repeat(Math.ceil(padLen / unit.length)).slice(0, padLen);
	return `${header}${body}`;
}

function byteLengthUtf8(s: string): number {
	return Buffer.byteLength(s, "utf8");
}

function approxTokens(chars: number, divisor: number): number {
	return Math.round(chars / divisor);
}

function main(): void {
	const cli = parseArgs(process.argv.slice(2));
	const phantom = loadConfig(cli.configPath);
	const memoryYaml = loadMemoryConfig(cli.memoryYamlPath);
	const evolution = loadEvolutionConfig(cli.evolutionYamlPath);
	const configDir = resolveConfigDir(evolution.paths.config_dir);

	const roleTemplate = cli.useRoleYaml ? loadRoleFromYaml(phantom.role, cli.rolesDir) : undefined;
	const evolved = cli.includeEvolved ? loadEvolvedForDump(configDir) : undefined;

	let memoryContext: string | undefined;
	if (cli.memoryFile) {
		memoryContext = readFileSync(resolve(cli.memoryFile), "utf-8");
	} else if (cli.memoryMode === "max") {
		const targetChars = memoryYaml.context.max_tokens * CHARS_PER_TOKEN;
		memoryContext = syntheticRecallBody(targetChars);
	} else {
		memoryContext = undefined;
	}

	const envSnapshot = cli.includeSnapshot ? formatEnvSnapshot(gatherEnvSnapshot()) : undefined;
	const projectContext = cli.projectFile ? readFileSync(resolve(cli.projectFile), "utf-8") : undefined;

	const sections = collectPromptAssemblySections(
		phantom,
		memoryContext,
		evolved,
		roleTemplate,
		undefined,
		cli.dataDir,
		envSnapshot,
		projectContext,
	);

	const rows: Array<{
		id: string;
		bytes: number;
		chars: number;
		tok4: number;
		tok32: number;
		pct: string;
	}> = [];

	let totalBytes = 0;
	for (const s of sections) {
		const bytes = byteLengthUtf8(s.content);
		const chars = s.content.length;
		totalBytes += bytes;
		rows.push({
			id: s.id,
			bytes,
			chars,
			tok4: approxTokens(chars, 4),
			tok32: approxTokens(chars, 3.2),
			pct: "",
		});
	}

	for (const r of rows) {
		r.pct = totalBytes > 0 ? `${((100 * r.bytes) / totalBytes).toFixed(1)}%` : "0%";
	}

	console.log("Phantom append prompt size dump");
	console.log(`phantom.yaml: ${resolve(cli.configPath)}`);
	console.log(`memory.yaml:  ${resolve(cli.memoryYamlPath)} (max_tokens=${memoryYaml.context.max_tokens})`);
	console.log(`evolved dir:  ${configDir} (included=${cli.includeEvolved})`);
	console.log(
		`memory recall: ${cli.memoryFile ? `file:${resolve(cli.memoryFile)}` : cli.memoryMode === "max" ? `synthetic chars=${Math.round(memoryYaml.context.max_tokens * CHARS_PER_TOKEN)}` : "omitted"}`,
	);
	console.log("");
	console.log(
		'Note: Runtime uses SDK systemPrompt { preset: "claude_code", append }. This table is append only. The preset adds more input tokens not measured here.',
	);
	console.log("");
	console.log(
		`${"section".padEnd(26)} ${"bytes".padStart(10)} ${"chars".padStart(8)} ${"tok~chars/4".padStart(12)} ${"tok~chars/3.2".padStart(14)} ${"pct".padStart(7)}`,
	);
	console.log("-".repeat(88));

	for (const r of rows) {
		console.log(
			`${r.id.padEnd(26)} ${String(r.bytes).padStart(10)} ${String(r.chars).padStart(8)} ${String(r.tok4).padStart(12)} ${String(r.tok32).padStart(14)} ${r.pct.padStart(7)}`,
		);
	}

	console.log("-".repeat(88));
	const totalChars = rows.reduce((a, r) => a + r.chars, 0);
	console.log(
		`${"TOTAL append".padEnd(26)} ${String(totalBytes).padStart(10)} ${String(totalChars).padStart(8)} ${String(approxTokens(totalChars, 4)).padStart(12)} ${String(approxTokens(totalChars, 3.2)).padStart(14)} ${"100.0%".padStart(7)}`,
	);
}

main();
