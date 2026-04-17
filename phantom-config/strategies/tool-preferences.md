# Tool Preferences

Preferred tool usage patterns.

- Use Bash tool `run_in_background: true` for long-running jobs (>1 minute) instead of shell `&`. This registers the job for automatic self-reporting when complete
- Trust registered tools directly; do not inspect schemas or explore tool availability before using them (they are documented and ready)
