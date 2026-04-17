# Corrections

User corrections with context.

- Avoid excessive tool call chains. Use registered tools directly without exploration/inspection steps (session 1776288811: agent made 5-6 calls to fetch conversation when 2 direct tool calls would suffice)
- Use `run_in_background: true` on Bash tool for >1min jobs instead of shell `&`. Agent admitted defaulting to fire-and-forget without notification mechanism (session 1776257294)
- When asked to run a specific evaluation or check, do that full run rather than a sample or exploratory version (session 1776338090)
