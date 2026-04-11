import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ProjectRegistry } from "./registry.ts";

function ok(data: Record<string, unknown>): { content: Array<{ type: "text"; text: string }> } {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
	return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

export type ProjectActivationCallback = (sessionKey: string, projectId: number) => void;

export function createProjectToolServer(
	registry: ProjectRegistry,
	onActivate?: ProjectActivationCallback,
	getCurrentSessionKey?: () => string | null,
): McpSdkServerConfigWithInstance {
	const projectTool = tool(
		"phantom_project",
		`Manage named projects. Each project has a name, optional working directory, and optional context file.
When a project is activated for the current session, its context is loaded into your system prompt
on the next message and your working directory is set to the project root.

ACTIONS:
- list: Show all registered projects.
- info: Get details about a specific project.
- activate: Bind a project to the current session. Context loads on the next message.
- register: Register a new project with a name and optional working_dir/context_path.
- update: Update a project's working_dir or context_path.
- remove: Remove a project registration.`,
		{
			action: z.enum(["list", "info", "activate", "register", "update", "remove"]),
			name: z.string().optional().describe("Project name (required for info, activate, register, update, remove)"),
			working_dir: z.string().optional().describe("Absolute path to the project root"),
			context_path: z.string().optional().describe("Path to a markdown context file for this project"),
			evolution_config_dir: z
				.string()
				.optional()
				.describe("Path to a directory for project-scoped evolved config (same structure as phantom-config/)"),
		},
		async (input) => {
			try {
				switch (input.action) {
					case "list": {
						const projects = registry.list();
						return ok({
							count: projects.length,
							projects: projects.map((p) => ({
								name: p.name,
								working_dir: p.working_dir,
								context_path: p.context_path,
								evolution_config_dir: p.evolution_config_dir,
							})),
						});
					}

					case "info": {
						if (!input.name) return err("name is required for info");
						const project = registry.get(input.name);
						if (!project) return err(`Project '${input.name}' not found`);
						const context = registry.loadContext(project);
						return ok({
							name: project.name,
							working_dir: project.working_dir,
							context_path: project.context_path,
							evolution_config_dir: project.evolution_config_dir,
							has_context: context != null,
							context_preview: context ? context.slice(0, 200) : null,
							created_at: project.created_at,
						});
					}

					case "activate": {
						if (!input.name) return err("name is required for activate");
						const project = registry.get(input.name);
						if (!project) return err(`Project '${input.name}' not found. Use 'register' first.`);
						const sessionKey = getCurrentSessionKey?.();
						if (sessionKey) {
							registry.setSessionProject(sessionKey, project.id);
							onActivate?.(sessionKey, project.id);
						}
						return ok({
							activated: true,
							name: project.name,
							working_dir: project.working_dir,
							note: "Project context will be loaded on the next message in this session.",
						});
					}

					case "register": {
						if (!input.name) return err("name is required for register");
						const project = registry.register(
							input.name,
							input.working_dir,
							input.context_path,
							input.evolution_config_dir,
						);
						return ok({
							registered: true,
							name: project.name,
							working_dir: project.working_dir,
							context_path: project.context_path,
							evolution_config_dir: project.evolution_config_dir,
						});
					}

					case "update": {
						if (!input.name) return err("name is required for update");
						const fields: { working_dir?: string; context_path?: string; evolution_config_dir?: string } = {};
						if (input.working_dir !== undefined) fields.working_dir = input.working_dir;
						if (input.context_path !== undefined) fields.context_path = input.context_path;
						if (input.evolution_config_dir !== undefined) fields.evolution_config_dir = input.evolution_config_dir;
						const project = registry.update(input.name, fields);
						return ok({
							updated: true,
							name: project.name,
							working_dir: project.working_dir,
							context_path: project.context_path,
							evolution_config_dir: project.evolution_config_dir,
						});
					}

					case "remove": {
						if (!input.name) return err("name is required for remove");
						const removed = registry.remove(input.name);
						return ok({ removed, name: input.name });
					}

					default:
						return err(`Unknown action: ${input.action}`);
				}
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				return err(msg);
			}
		},
	);

	return createSdkMcpServer({
		name: "phantom-projects",
		tools: [projectTool],
	});
}
