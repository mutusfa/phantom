# Domain Knowledge

Accumulated domain expertise from interactions.

## Phantom Codebase

- Runtime: Bun (TypeScript), no bundler. Run with `bun run src/index.ts`.
- Test: `bun test` (800+ tests). Lint: `bun run lint` (Biome). Typecheck: `bun run typecheck`.
- MCP server on port 3100 with bearer token auth. Tokens in config/mcp.yaml (SHA-256 hashed).
- Evolution engine runs after each session (or every 10 sessions if cadence configured). Config in config/evolution.yaml.
- Slack file attachments are fetched inline (text-based files under 200KB) via `fetchSlackFiles()` in src/channels/slack.ts.

## Integrations

- Azure DevOps MCP: wired via stdio factory in src/index.ts. Requires env vars ADO_MCP_AUTH_TOKEN and ADO_ORGANIZATION. Uses `@azure-devops/mcp` package via `bunx -y`. Org: PromosApp (dev.azure.com/PromosApp), project: PromosApp (id: 9e49de81-0fbb-4bd1-8b06-3e577d63205e). 80+ ADO tools available.
- LinkedIn automation: scripts in scripts/ (linkedin_dms.py, linkedin_playwright.py, linkedin_send_message.py). Uses Playwright for persistent browser sessions (avoids cookie refresh issues).
- LinkedIn sweep protocol: when reviewing recruiter threads, run `linkedin_playwright.py links <backend_urn>` to extract external URLs from each thread. For any job posting URLs found, delegate to a Haiku subagent (model: haiku) to fetch and summarize: title, company, location, salary/comp, tech stack, role summary, red flags. Never open untrusted URLs in the main agent context.

## Infrastructure

- Phantom runs on a Raspberry Pi (DietPi) accessible via SSH. The user's local machine is a separate environment.
- Interactive commands requiring browser flows (OAuth, auth logins) must be run in an SSH session on the Pi, not executed locally.
- The user prefers using Claude.ai subscription OAuth credentials (~/.claude/.credentials.json) over pay-as-you-go API keys for Phantom's agent runtime.

## Collaborative Projects

- receipt-processing-monitoring: separate collaborative project. User contributes code directly, so changes to that repo must go via PRs (not direct commits).
