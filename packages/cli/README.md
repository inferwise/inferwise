# inferwise

**Know and control your pay-as-you-go LLM API costs before they ship.**

Inferwise scans your codebase for LLM API calls (`messages.create()`, `chat.completions.create()`, etc.), estimates per-token costs, enforces budget policies, and diffs costs between branches. Works with any CI system or locally as a git hook.

> **Note:** Inferwise tracks pay-as-you-go API costs (billed per token to your API key). It does not track flat-rate subscriptions like Claude Code, Cursor, Copilot, or ChatGPT Plus.

## Quick Start

```bash
# Scan — no install, no config
npx inferwise estimate .

# Set up config + git hooks + CI
npx inferwise init
```

Or install globally:

```bash
npm install -g inferwise
```

## Commands

### `inferwise init`

Set up config file, git hooks (husky/lefthook/plain git), and print CI setup instructions for GitHub Actions, GitLab CI, Bitbucket, and more.

### `inferwise estimate [path]`

Scan for LLM API calls and estimate costs.

```bash
inferwise estimate .
inferwise estimate ./src --volume 5000
inferwise estimate . --format json
inferwise estimate . --precise          # Exact counts via provider APIs
```

### `inferwise diff [path]`

Compare token costs between two git refs. Enforces budget policy from `inferwise.config.json`.

```bash
inferwise diff
inferwise diff --base main --head HEAD
inferwise diff --fail-on-increase 500
```

### `inferwise check [path]`

Verify total LLM costs are within budget. Exits with code 1 if exceeded. For AI agents and automation.

```bash
inferwise check . --max-monthly-cost 10000
inferwise check . --max-cost-per-call 0.05
```

### `inferwise calibrate [path]`

Fetch real usage from provider APIs (Anthropic, OpenAI) and compute correction factors for more accurate estimates.

```bash
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-... inferwise calibrate .
inferwise calibrate . --dry-run
```

### `inferwise audit [path]`

Find cost optimizations: cheaper models, cacheable responses, batchable calls.

### `inferwise price [provider] [model]`

Look up model pricing. Compare models side-by-side. Designed for humans and AI agents.

```bash
inferwise price anthropic claude-sonnet-4
inferwise price --compare anthropic/claude-sonnet-4 openai/gpt-4o
inferwise price --list-all
```

## Budget Enforcement

Add `budgets` to `inferwise.config.json` (created by `inferwise init`):

```json
{
  "budgets": {
    "warn": 2000,
    "block": 50000,
    "requireApproval": 10000,
    "approvers": ["platform-eng"]
  }
}
```

- `warn` — flags the PR with a warning label
- `block` — fails the CI check, blocks merge (emergency brake)
- `requireApproval` — requests review from approvers before merge

## SDK (Programmatic API)

```typescript
import { estimateAndCheck } from "inferwise/sdk";

const result = await estimateAndCheck("./src", { maxMonthlyCost: 10000 });
if (!result.ok) {
  console.error("Over budget:", result.violations);
}
```

Pure data, no console output, no `process.exit` — safe for embedding in agent orchestration, pipelines, or automation.

## Supported Providers

Anthropic, OpenAI, Google AI, xAI — with LangChain and Vercel AI SDK pattern detection.

**File types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

## Documentation

See the [main repo](https://github.com/inferwise/inferwise) for full documentation, CI setup guides, and estimation methodology.

## License

Apache 2.0
