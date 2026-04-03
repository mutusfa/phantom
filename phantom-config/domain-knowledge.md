# Domain Knowledge

Accumulated domain expertise from interactions.

## Phantom Codebase

- Runtime: Bun (TypeScript), no bundler. Run with `bun run src/index.ts`.
- Test: `bun test` (800+ tests). Lint: `bun run lint` (Biome). Typecheck: `bun run typecheck`.
- MCP server on port 3100 with bearer token auth. Tokens in config/mcp.yaml (SHA-256 hashed).
- Evolution engine runs after each session (or every 10 sessions if cadence configured). Config in config/evolution.yaml.
- Slack file attachments are fetched inline (text-based files under 200KB) via `fetchSlackFiles()` in src/channels/slack.ts.

## Integrations

- Azure DevOps MCP: wired via stdio factory in src/index.ts. Requires env vars ADO_MCP_AUTH_TOKEN and ADO_ORGANIZATION. Uses `@azure-devops/mcp` package via `bunx -y`.
- LinkedIn automation: scripts in scripts/ (linkedin_dms.py, linkedin_playwright.py, linkedin_send_message.py). Uses Playwright for persistent browser sessions (avoids cookie refresh issues).

## Collaborative Projects

- receipt-processing-monitoring: separate collaborative project. User contributes code directly, so changes to that repo must go via PRs (not direct commits).
