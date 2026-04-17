import type { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema.ts";

export function runMigrations(db: Database): void {
	db.run(`CREATE TABLE IF NOT EXISTS _migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		index_num INTEGER UNIQUE NOT NULL,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	const applied = new Set(
		db
			.query("SELECT index_num FROM _migrations")
			.all()
			.map((row) => (row as { index_num: number }).index_num),
	);

	for (let i = 0; i < MIGRATIONS.length; i++) {
		if (applied.has(i)) continue;
		try {
			db.run(MIGRATIONS[i]);
		} catch (err: unknown) {
			// ALTER TABLE ADD COLUMN is idempotent in intent - if the column already
			// exists (e.g. created directly in a prior schema version), treat the
			// migration as applied rather than crashing. Any other error is fatal.
			const isAddColumn = /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(MIGRATIONS[i]);
			const isDuplicateColumn =
				err instanceof Error && err.message.includes("duplicate column name");
			if (!(isAddColumn && isDuplicateColumn)) {
				throw err;
			}
			console.warn(
				`[migrate] Migration ${i} skipped: column already exists (${err instanceof Error ? err.message : String(err)})`,
			);
		}
		db.run("INSERT INTO _migrations (index_num) VALUES (?)", [i]);
	}
}
