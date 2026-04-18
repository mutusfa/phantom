import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { LOCAL_MIGRATIONS } from "./schema.local.ts";
import { MIGRATIONS } from "./schema.ts";

function hashMigration(sql: string): string {
	return createHash("sha256").update(sql.trim()).digest("hex");
}

// The upstream MIGRATIONS array had 44 entries before LOCAL_MIGRATIONS was
// extracted to a separate file. This constant drives a one-time backfill that
// assigns content hashes to rows recorded by the old index-based runner:
// rows at index_num < 44 are upstream migrations (stable, same position),
// rows at index_num >= 44 were local migrations (now in LOCAL_MIGRATIONS).
const PRE_SPLIT_UPSTREAM_COUNT = 44;

export function runMigrations(db: Database): void {
	db.run(`CREATE TABLE IF NOT EXISTS _migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		index_num INTEGER UNIQUE NOT NULL,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	// Add content_hash column for stable idempotency across index shifts.
	// This ALTER is safe to re-run; the duplicate-column catch below handles it.
	try {
		db.run("ALTER TABLE _migrations ADD COLUMN content_hash TEXT");
	} catch (err: unknown) {
		if (!(err instanceof Error && err.message.includes("duplicate column name"))) throw err;
	}

	const ALL_MIGRATIONS = [...MIGRATIONS, ...LOCAL_MIGRATIONS];

	// One-time backfill: populate content_hash for rows recorded before the
	// schema split (when everything was a single index-based array). Rows with
	// index_num < PRE_SPLIT_UPSTREAM_COUNT are upstream migrations that still
	// sit at the same position. Rows at higher indices were local migrations
	// and map to LOCAL_MIGRATIONS[index_num - PRE_SPLIT_UPSTREAM_COUNT].
	const rowsWithoutHash = db
		.query("SELECT index_num FROM _migrations WHERE content_hash IS NULL")
		.all() as { index_num: number }[];
	for (const { index_num } of rowsWithoutHash) {
		let sql: string | undefined;
		if (index_num < PRE_SPLIT_UPSTREAM_COUNT) {
			sql = MIGRATIONS[index_num];
		} else {
			sql = LOCAL_MIGRATIONS[index_num - PRE_SPLIT_UPSTREAM_COUNT];
		}
		if (sql) {
			db.run("UPDATE _migrations SET content_hash = ? WHERE index_num = ?", [
				hashMigration(sql),
				index_num,
			]);
		}
	}

	// Primary idempotency check: content hash rather than array index.
	// This keeps already-applied migrations stable when upstream inserts
	// new entries before our local ones after a rebase.
	const appliedHashes = new Set(
		(
			db
				.query("SELECT content_hash FROM _migrations WHERE content_hash IS NOT NULL")
				.all() as { content_hash: string }[]
		).map((r) => r.content_hash),
	);

	// Assign new index_nums after the current max to preserve ordering.
	const maxRow = db.query("SELECT COALESCE(MAX(index_num), -1) as m FROM _migrations").get() as {
		m: number;
	};
	let nextIndex = maxRow.m + 1;

	for (let i = 0; i < ALL_MIGRATIONS.length; i++) {
		const hash = hashMigration(ALL_MIGRATIONS[i]);
		if (appliedHashes.has(hash)) continue;
		try {
			db.run(ALL_MIGRATIONS[i]);
		} catch (err: unknown) {
			// ALTER TABLE ADD COLUMN is idempotent in intent - if the column already
			// exists (e.g. created directly in a prior schema version), treat the
			// migration as applied rather than crashing. Any other error is fatal.
			const isAddColumn = /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN/i.test(ALL_MIGRATIONS[i]);
			const isDuplicateColumn =
				err instanceof Error && err.message.includes("duplicate column name");
			if (!(isAddColumn && isDuplicateColumn)) {
				throw err;
			}
			console.warn(
				`[migrate] Migration ${i} skipped: column already exists (${err instanceof Error ? err.message : String(err)})`,
			);
		}
		db.run("INSERT INTO _migrations (index_num, content_hash) VALUES (?, ?)", [nextIndex, hash]);
		nextIndex++;
		appliedHashes.add(hash);
	}
}
