import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DynamicToolDef } from "./dynamic-tools.ts";

// Shell commands get 30 seconds; scripts get 60 (compile + run overhead).
const SHELL_TIMEOUT_MS = 30_000;
const SCRIPT_TIMEOUT_MS = 60_000;
// Prevent runaway output from filling memory (100KB is generous for tool responses).
const MAX_OUTPUT_BYTES = 100_000;

/**
 * Safe environment for subprocess execution.
 * Only expose what dynamic tools legitimately need.
 * Secrets (API keys, tokens) are never passed to subprocesses.
 */
export function buildSafeEnv(input: Record<string, unknown>): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
		HOME: process.env.HOME ?? "/tmp",
		LANG: process.env.LANG ?? "en_US.UTF-8",
		TERM: process.env.TERM ?? "xterm-256color",
		TOOL_INPUT: JSON.stringify(input),
	};
}

export async function executeDynamicHandler(
	tool: DynamicToolDef,
	input: Record<string, unknown>,
): Promise<CallToolResult> {
	try {
		switch (tool.handlerType) {
			case "script":
				return executeScriptHandler(tool.handlerPath ?? "", input);
			case "shell":
				return executeShellHandler(tool.handlerCode ?? "", input);
			default:
				return {
					content: [
						{
							type: "text",
							text: `Unknown handler type: ${tool.handlerType}. Only "script" and "shell" are supported.`,
						},
					],
					isError: true,
				};
		}
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text", text: `Error executing tool '${tool.name}': ${msg}` }],
			isError: true,
		};
	}
}

async function executeScriptHandler(path: string, input: Record<string, unknown>): Promise<CallToolResult> {
	const { existsSync } = await import("node:fs");
	if (!existsSync(path)) {
		return {
			content: [{ type: "text", text: `Script not found: ${path}` }],
			isError: true,
		};
	}

	// --env-file= prevents bun from auto-loading .env/.env.local files,
	// which would leak secrets into the subprocess despite buildSafeEnv.
	const proc = Bun.spawn(["bun", "--env-file=", "run", path], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: buildSafeEnv(input),
	});

	proc.stdin.write(JSON.stringify(input));
	proc.stdin.end();

	const killTimeout = setTimeout(() => proc.kill(), SCRIPT_TIMEOUT_MS);

	try {
		// Read stdout and stderr in parallel to avoid pipe-buffer deadlock on large output.
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const isTimeout = exitCode === null || exitCode === 143;
			return {
				content: [
					{
						type: "text",
						text: isTimeout
							? `Script timed out after ${SCRIPT_TIMEOUT_MS / 1000}s`
							: `Script error (exit ${exitCode}): ${stderr || stdout}`,
					},
				],
				isError: true,
			};
		}

		return { content: [{ type: "text", text: stdout.trim() }] };
	} finally {
		clearTimeout(killTimeout);
	}
}

async function executeShellHandler(command: string, input: Record<string, unknown>): Promise<CallToolResult> {
	// Wrap the user command in a subshell so that `exit` calls don't prevent the
	// marker from being printed. The marker encodes the subshell exit code so we
	// can detect both early completion and failure status from the output stream.
	const markerId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
	const marker = `PHANTOM_DONE_${markerId}`;
	const wrappedCommand = `(\n${command}\n)\n_pe=$?\nprintf '%s %d\\n' '${marker}' $_pe`;

	const proc = Bun.spawn(["bash", "-c", wrappedCommand], {
		stdout: "pipe",
		stderr: "pipe",
		env: buildSafeEnv(input),
	});

	const killTimeout = setTimeout(() => proc.kill(), SHELL_TIMEOUT_MS);

	let totalBytes = 0;
	let markerFound = false;
	let markerExitCode = 0;
	const stdoutParts: string[] = [];
	const decoder = new TextDecoder();
	// Rolling buffer for cross-chunk marker detection without O(n^2) joins.
	let tailBuffer = "";

	try {
		for await (const chunk of proc.stdout) {
			const text = decoder.decode(chunk, { stream: true });
			stdoutParts.push(text);
			totalBytes += chunk.byteLength;

			tailBuffer += text;
			const markerIdx = tailBuffer.indexOf(marker);
			if (markerIdx >= 0) {
				markerFound = true;
				const afterMarker = tailBuffer.slice(markerIdx + marker.length).trim();
				const exitMatch = afterMarker.match(/^(\d+)/);
				markerExitCode = exitMatch?.[1] ? parseInt(exitMatch[1], 10) : 0;
				break;
			}
			// Keep tail buffer bounded - only need enough chars to span a split marker.
			if (tailBuffer.length > marker.length * 4) {
				tailBuffer = tailBuffer.slice(-(marker.length * 2));
			}

			if (totalBytes > MAX_OUTPUT_BYTES) {
				proc.kill();
				await proc.exited;
				return {
					content: [{ type: "text", text: `Output size limit exceeded (${MAX_OUTPUT_BYTES} bytes)` }],
					isError: true,
				};
			}
		}
	} finally {
		clearTimeout(killTimeout);
	}

	const exitCode = await proc.exited;

	if (!markerFound) {
		// Process ended without printing the marker: timeout or unexpected termination.
		const stderr = await new Response(proc.stderr).text().catch(() => "");
		const isTimeout = exitCode === null || exitCode === 143; // 143 = SIGTERM
		return {
			content: [
				{
					type: "text",
					text: isTimeout
						? `Shell command timed out after ${SHELL_TIMEOUT_MS / 1000}s`
						: `Shell error (exit ${exitCode ?? "unknown"}): ${stderr || stdoutParts.join("").trim()}`,
				},
			],
			isError: true,
		};
	}

	if (markerExitCode !== 0) {
		const stderr = await new Response(proc.stderr).text().catch(() => "");
		return {
			content: [
				{
					type: "text",
					text: `Shell error (exit ${markerExitCode}): ${stderr || stdoutParts.join("").trim()}`,
				},
			],
			isError: true,
		};
	}

	// Strip the marker line and any trailing content from stdout.
	let stdout = stdoutParts.join("");
	const markerPos = stdout.indexOf(marker);
	if (markerPos >= 0) {
		stdout = stdout.slice(0, markerPos);
	}

	return { content: [{ type: "text", text: stdout.trim() }] };
}
