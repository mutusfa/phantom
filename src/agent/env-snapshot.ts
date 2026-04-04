import { existsSync } from "node:fs";

/**
 * Captures the real-time state of the execution environment at session start.
 * Injected into the system prompt so the agent immediately knows which tools
 * are available, eliminating early "reconnaissance" turns spent running `which`
 * and `free` commands. Inspired by the bootstrap approach in meta-harness-tbench2.
 */

export interface EnvSnapshot {
	/** ISO timestamp when the snapshot was taken */
	timestamp: string;
	/** CLI tools found in PATH */
	availableTools: string[];
	/** CLI tools not found in PATH */
	unavailableTools: string[];
	/** Whether the Docker daemon socket is accessible */
	dockerReady: boolean;
	/** Free memory in MB, 0 if unavailable */
	freeMemoryMb: number;
}

const TOOLS_TO_CHECK = ["bun", "node", "python3", "git", "docker", "gh", "curl", "jq"] as const;

function toolExists(name: string): boolean {
	const proc = Bun.spawnSync(["which", name], { stdout: "pipe", stderr: "pipe" });
	return proc.exitCode === 0;
}

function getFreeMemoryMb(): number {
	const proc = Bun.spawnSync(["free", "-m"], { stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) return 0;
	const text = new TextDecoder().decode(proc.stdout);
	// Output format: "Mem:  total  used  free  shared  buff/cache  available"
	const match = text.match(/^Mem:\s+\d+\s+\d+\s+(\d+)/m);
	return match?.[1] ? parseInt(match[1], 10) : 0;
}

export function gatherEnvSnapshot(): EnvSnapshot {
	const available: string[] = [];
	const unavailable: string[] = [];

	for (const tool of TOOLS_TO_CHECK) {
		if (toolExists(tool)) {
			available.push(tool);
		} else {
			unavailable.push(tool);
		}
	}

	return {
		timestamp: new Date().toISOString(),
		availableTools: available,
		unavailableTools: unavailable,
		// Checking socket existence is faster and sufficient vs running `docker info`
		dockerReady: existsSync("/var/run/docker.sock"),
		freeMemoryMb: getFreeMemoryMb(),
	};
}

export function formatEnvSnapshot(snapshot: EnvSnapshot): string {
	const lines: string[] = ["# Current Session State", ""];

	if (snapshot.availableTools.length > 0) {
		lines.push(`Available tools: ${snapshot.availableTools.join(", ")}`);
	}
	if (snapshot.unavailableTools.length > 0) {
		lines.push(`Not available: ${snapshot.unavailableTools.join(", ")}`);
	}

	lines.push(`Docker: ${snapshot.dockerReady ? "ready" : "not available"}`);

	if (snapshot.freeMemoryMb > 0) {
		lines.push(`Free memory: ${snapshot.freeMemoryMb}MB`);
	}

	lines.push(`Captured: ${snapshot.timestamp}`);

	return lines.join("\n");
}
