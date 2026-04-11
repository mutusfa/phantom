# Per-project context and evolution

Phantom can bind a **named project** to a channel conversation or to one-off runs (HTTP `/trigger`, MCP `phantom_ask`, scheduled jobs). Binding sets optional **working directory** (SDK `cwd`), loads **project context** markdown into the system prompt, merges **project evolved config** with global `phantom-config/`, and routes **self-evolution** for that session into a separate directory with its own `meta/version.json`.

## Registering and activating

- In chat, the agent uses the in-process tool **`phantom_project`** (`phantom-projects` MCP server): `register`, `activate`, `list`, `info`, `update`, `remove`.
- **Activate** binds the current session. **Context and cwd apply on the next user message** in that thread (the SDK session already started for the current turn).
- Registering a project sets defaults:
  - `context_path`: `data/projects/<name>/context.md`, unless `data/harness-runs/<name>/context.md` already exists (then that path is used).
  - `evolution_config_dir`: `data/projects/<name>/evolved/` (same layout as `phantom-config/`).

## Global vs project knowledge

| Location | Use for |
|----------|---------|
| `phantom-config/user-profile.md` | Owner preferences that span all repos |
| `phantom-config/domain-knowledge.md` | Cross-cutting facts, not repo-specific |
| `data/projects/<name>/context.md` (or harness `context.md`) | Repo or product instructions, stack, conventions |
| `data/projects/<name>/evolved/` | Project-scoped evolution (own version history) |

## External APIs

- **`POST /trigger`**: JSON body may include `"project": "<registered-name>"` next to `"task"`.
- **MCP** `phantom_ask` and `phantom_review_request`: optional `project` string (registered name).
- **Scheduler** `phantom_schedule` create: optional `project_name` (stored on the job; each run binds that project).

## Harness

`scripts/harness-run.ts` always runs **project-scoped evolution** after the propose-evaluate loop, targeting `data/projects/<project>/evolved/` unless the manifest sets `evolution_config_dir`. The harness summary uses `bypass_cadence` so evolution runs once per harness completion regardless of global reflection interval.
