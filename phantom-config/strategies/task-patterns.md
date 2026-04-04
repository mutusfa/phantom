# Task Patterns

Learned task execution patterns.

- Collaborative repos where the user also codes: always submit changes via PR, never direct commit to main. Keep code clean and readable.
- When asked about cost/token usage: show cache hit % alongside raw in/out counts (more informative than raw tokens alone).
- Commit code changes only after tests pass - not proactively at end of session. Run `bun test` first; if green, then commit. Do not commit speculatively.
