// Single source of truth for phantom-config paths.
//
// This module exists so that every reference to the evolved-config tree or the
// agent-notes file resolves through one place. When upstream refactors nearby
// code (paths.ts, storage.ts, the dashboard) we only need to deconflict one
// line per consumer instead of ten scattered string literals.
//
// History: evolved config used to live at top-level `phantom-config/`. It was
// migrated to `data/phantom-config/` because `data/` is gitignored in full and
// persists on the Pi filesystem; evolved config then survives restarts and
// re-clones without needing gitignore exceptions. The top-level
// `phantom-config/` directory still exists in the repo as a legacy ghost
// (tracked: `constitution.md`, `persona.md`; everything else gitignored) but
// is never read or written by the running engine.

// On-disk root of evolved config. config/evolution.yaml `paths.*` keys must
// stay consistent with this value.
export const PHANTOM_CONFIG_DIR = "data/phantom-config";

// On-disk directory that holds agent-authored memory files
// (agent-notes.md today; corrections.md and principles.md will follow).
export const PHANTOM_CONFIG_MEMORY_DIR = `${PHANTOM_CONFIG_DIR}/memory`;

// The canonical path the system prompt teaches the main agent. If this string
// changes, the agent's existing notes file must be moved to match or the
// append chain breaks.
export const AGENT_NOTES_PATH = `${PHANTOM_CONFIG_MEMORY_DIR}/agent-notes.md`;

// Virtual prefix the dashboard memory-files API exposes for phantom-config
// memory. Kept at the legacy value on purpose: upstream is actively iterating
// on the dashboard and `public/dashboard/memory-files.js` hardcodes this
// string to strip the prefix for display. Changing it here would force a
// matching change in the dashboard JS and every memory-files test, which is
// the exact upstream-churn surface we are trying to avoid.
// TODO: once upstream dashboard work settles, align this to
// `data/phantom-config/memory/` so the API surface matches the on-disk layout.
export const PHANTOM_CONFIG_VIRTUAL_PREFIX = "phantom-config/memory/";
