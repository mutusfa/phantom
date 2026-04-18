// Local schema additions that are not part of the upstream phantom repo.
// Kept in a separate file to avoid merge conflicts with schema.ts.
// migrate.ts combines MIGRATIONS and LOCAL_MIGRATIONS at runtime.
export const LOCAL_MIGRATIONS: string[] = [
	// Cache token tracking: add columns to cost_events and sessions
	"ALTER TABLE cost_events ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE cost_events ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE sessions ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0",

	// Behavior eval: explicit feedback signals (thumbs up/down reactions)
	`CREATE TABLE IF NOT EXISTS session_feedback (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_key TEXT NOT NULL,
		type TEXT NOT NULL,
		source TEXT NOT NULL DEFAULT 'reaction',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,

	// Behavior eval: per-session intervention counts from heuristic detection
	"ALTER TABLE sessions ADD COLUMN correction_count INTEGER NOT NULL DEFAULT 0",
	"ALTER TABLE sessions ADD COLUMN confirmation_count INTEGER NOT NULL DEFAULT 0",

	// Per-project context: named projects with working directory and context file
	`CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		working_dir TEXT,
		context_path TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`,
	"ALTER TABLE sessions ADD COLUMN project_id INTEGER REFERENCES projects(id)",

	// Per-project evolution: optional config directory for project-scoped evolved config
	"ALTER TABLE projects ADD COLUMN evolution_config_dir TEXT",

	// Scheduler: bind scheduled runs to a named project (cwd, context, merged evolved prompt, evolution scope)
	"ALTER TABLE scheduled_jobs ADD COLUMN project_name TEXT",
];
