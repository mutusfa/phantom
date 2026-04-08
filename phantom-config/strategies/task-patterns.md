# Task Patterns

Learned task execution patterns.

- Collaborative repos where the user also codes: always submit changes via PR, never direct commit to main. Keep code clean and readable.
- When asked about cost/token usage: show cache hit % alongside raw in/out counts (more informative than raw tokens alone).
- Commit new features as soon as tests are green - don't wait for end of session or an explicit request. Run `bun test`; if green, commit immediately. Do not commit speculatively (before tests pass).
- LinkedIn recruiter sweep: always extract and surface salary/comp details. Include a "Compensation" line in every thread summary; if none mentioned, write "No salary info mentioned."
- When user asks for a "plan", write it to a file (plans/<topic>.md) before responding. Plans must persist across sessions, not live only in chat.
