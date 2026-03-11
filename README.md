# Inferwise

**Cost guardrails for LLM API calls.**

[![CI](https://github.com/inferwise/inferwise/actions/workflows/ci.yml/badge.svg)](https://github.com/inferwise/inferwise/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/inferwise)](https://www.npmjs.com/package/inferwise)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Inferwise scans your codebase for LLM API calls (Anthropic, OpenAI, Google, xAI), estimates per-token costs, and enforces budget guardrails — from pre-commit to CI to merge. Whether a human or an AI agent wrote the code, nothing ships without cost visibility.

---

## Quick Start

```bash
# Scan your project — no install, no config required
npx inferwise estimate .

# Set up guardrails: config + git hooks + CI instructions
npx inferwise init

# Compare costs between branches
npx inferwise diff
```

Or install globally:

```bash
npm install -g inferwise
# or
pnpm add -g inferwise
```

---

## The Problem

Your code makes LLM API calls that are billed per token — every `messages.create()`, every `chat.completions.create()`. There is no cost visibility in the development workflow. Someone swaps `gpt-4o-mini` for `claude-opus-4` and nobody notices until the invoice arrives. An AI coding agent picks the most expensive model for every call because it optimizes for correctness, not cost.

**The bill shows up after the code ships. Inferwise moves cost visibility before the code ships.**

---

## End-to-End Guardrail Pipeline

This is the critical path. Every LLM API call in your codebase passes through three enforcement tiers before it reaches production.

```
Code written (by human or AI agent)
        |
        v
  +-----------+
  |  TIER 1   |  Pre-commit hook (developer machine)
  |           |  inferwise estimate .
  |           |  "This commit adds $2,400/mo in LLM costs"
  +-----+-----+
        |  developer pushes
        v
  +-----------+
  |  TIER 2   |  CI gate (GitHub Action / GitLab / any CI)
  |           |  inferwise diff --base main --head HEAD
  |           |  Posts cost report on PR, applies labels
  +-----+-----+
        |  budget check
        v
  +-----------+
  |  TIER 3   |  Budget policy (inferwise.config.json)
  |           |  warn: $2,000   -> yellow label, warning in PR
  |           |  block: $50,000 -> exit code 1, fails CI, blocks merge
  +-----------+
```

| Tier | Where | What Happens |
|------|-------|--------------|
| Pre-commit hook | Developer machine | Shows costs before commit, catches obvious spikes |
| CI required check | PR/MR merge gate | Blocks merge if budget exceeded, comments cost report |
| Budget policy | `inferwise.config.json` | Org-wide thresholds committed to the repo, code-reviewed like any other config |

### How budget thresholds behave

| Threshold | CLI (`diff` / `check`) | GitHub Action |
|-----------|----------------------|---------------|
| `warn` | Prints warning to stderr | Yellow `cost-warning` label + warning in PR comment |
| `requireApproval` | No effect | Orange `cost-approval-required` label + requests review from configured `approvers` |
| `block` | **Exit code 1** — fails the pipeline | Red `cost-blocked` label + **fails the CI check**, blocks merge |

**`warn`** and **`block`** are hard guardrails — they work in any CI system because they're driven by the CLI's exit code. `block` is the real enforcement: if the cost delta exceeds the threshold, the command fails and the merge is blocked.

**`requireApproval`** is a soft gate — it only works in the GitHub Action. It applies a label and requests reviewers, but does not fail CI on its own. Whether it actually blocks the merge depends on your GitHub branch protection rules (e.g., "require approving reviews before merge"). If you don't have branch protection configured, `requireApproval` is advisory only.

**For AI agents and pipelines:** Only `block` matters. The SDK and CLI return a pass/fail result. There is no concept of "request approval" in an automated pipeline — if the cost is over budget, the check fails (exit code 1) and the agent can react (swap models, add `max_tokens`, etc.).

---

### For Developers: The Day-to-Day Workflow

**1. Setup (once)**

```bash
npx inferwise init
```

Creates `inferwise.config.json`, installs a pre-commit hook, prints CI setup instructions for GitHub Actions / GitLab / Bitbucket / Jenkins.

**2. Write code with LLM API calls**

You (or an AI coding agent) write code that calls provider APIs. On `git commit`, the pre-commit hook runs automatically:

```
$ git commit -m "feat: add summarizer"

File               Line  Provider   Model           Cost/Call  Monthly
src/summarize.ts   18    openai     gpt-4o          $0.0064    $192/mo
src/rag.ts         91    anthropic  claude-opus-4   $0.0429    $1,287/mo

Total: $1,479/mo (at 1,000 req/day)
```

You see the cost impact before the code leaves your machine.

**3. Open a pull request**

CI runs `inferwise diff`. The GitHub Action posts a cost report directly on the PR:

| File | Model | Change | Monthly Impact |
|------|-------|--------|----------------|
| src/summarize.ts | (new) gpt-4o | Added | +$192/mo |
| src/rag.ts | claude-sonnet-4 -> claude-opus-4 | Upgrade | +$1,050/mo |

**Net: +$1,242/mo**

If the increase exceeds `budgets.block`, the PR is blocked from merging.

**4. Calibrate for tighter estimates (optional)**

```bash
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-... inferwise calibrate .
```

Fetches real usage data from provider APIs, computes correction ratios, and stores them locally. Future estimates go from "2-5x accuracy" to "within 20%".

---

### For AI Agents: The Programmatic Guardrail

AI coding agents (Cursor, Claude Code, Copilot, Codex) and custom pipelines generate LLM API calls without a human reviewing cost implications. Inferwise provides three integration levels so agents can self-check before shipping expensive code.

**Option A: SDK — embed directly in agent pipelines**

```typescript
import { estimateAndCheck, estimate } from "inferwise/sdk";

// Budget gate — returns { ok, violations, rows, totalMonthlyCost }
const result = await estimateAndCheck("./src", {
  maxMonthlyCost: 10000,
  maxCostPerCall: 0.10,
  volume: 5000,
});

if (!result.ok) {
  // Agent reacts: swap models, add max_tokens, etc.
  console.error("Over budget:", result.violations);
}

// Or just get estimates without checking
const costs = await estimate("./src", { volume: 1000 });
console.log(`Total: $${costs.totalMonthlyCost.toFixed(2)}/mo`);
```

Pure data, no console output, no `process.exit`. Safe for embedding in agent orchestration layers, n8n/Zapier nodes, or custom pipelines.

**Option B: CLI — tool-use for agents and scripts**

```bash
# Budget gate — exits 1 if over budget
inferwise check . --max-monthly-cost 10000 --format json

# Agent queries cost before choosing a model
inferwise price openai gpt-4o --input-tokens 2000 --output-tokens 1000 --format json

# Compare model options programmatically
inferwise price --compare anthropic/claude-sonnet-4 openai/gpt-4o --format json
```

**Option C: Pricing database — for model routers and cost-aware selection**

```typescript
import { getModel, calculateCost, getAllModels } from "@inferwise/pricing-db";

// Pre-flight cost check
const model = getModel("anthropic", "claude-sonnet-4-20250514");
const cost = calculateCost({ model, inputTokens: 2000, outputTokens: 1000 });

// Build a cost-aware model router
const budget = 0.01; // max $/call
const candidates = getAllModels()
  .filter(m => m.tier === "mid" && m.supports_tools)
  .sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
```

---

### Concrete Example

An AI coding agent builds a RAG pipeline and writes API calls using Opus for every step — embeddings, retrieval, summarization, response generation. Those calls will run in your production, billed per token to your API key.

Inferwise flags: **"+$2,400/mo in new API costs"** on the PR.

The developer asks the agent to use Sonnet where Opus isn't needed. Cost drops to **$600/mo**.

**$1,800/mo saved before a single line ships.**

---

## What Inferwise Tracks (and Doesn't)

Inferwise tracks **pay-as-you-go LLM API calls in your source code** — the code your application runs in production that hits provider APIs and gets billed per token.

**Tracked (per-token API costs):**
- `anthropic.messages.create()` — billed per token to your Anthropic API key
- `openai.chat.completions.create()` — billed per token to your OpenAI API key
- `genai.generateContent()` — billed per token to your Google AI API key
- LangChain / Vercel AI SDK wrappers that call the above APIs
- Any code that makes HTTP requests to LLM provider APIs

**NOT tracked (flat-rate subscriptions):**
- Claude Code / Claude Pro / Claude Max subscriptions
- Cursor Pro / Business subscriptions
- GitHub Copilot subscriptions
- ChatGPT Plus / Team / Enterprise seats
- Codex usage (billed through OpenAI's platform, not your API key)

The distinction: Inferwise doesn't care about the **tool you use to write code** (subscription). It cares about the **LLM API calls your code makes** when it runs in production (pay-as-you-go). A Cursor subscription costs a fixed $20/mo regardless of usage. But the `openai.chat.completions.create()` call that Cursor helped you write? That gets billed per token, at scale, and that's what Inferwise estimates and gates.

---

## What Ships: Three Packages

| Package | Who Uses It | What It Does |
|---------|------------|--------------|
| [`inferwise`](https://www.npmjs.com/package/inferwise) | Developers, CI, AI agents | CLI + SDK — scan, estimate, diff, check, enforce budgets |
| [`@inferwise/pricing-db`](packages/pricing-db) | Model routers, cost-aware apps | Bundled pricing for 35+ models across 4 providers, updated daily |
| [`inferwise/inferwise-action`](packages/github-action) | GitHub repos | PR cost comments, labels, reviewer requests, merge blocking |

---

## Commands

### `inferwise init`

Set up Inferwise in your project — creates config, installs git hooks, prints CI setup instructions.

```bash
inferwise init                    # Full setup
inferwise init --no-hooks         # Config only, skip git hooks
inferwise init --hook pre-push    # Use pre-push instead of pre-commit
```

Creates `inferwise.config.json` with sensible defaults and auto-detects your hook manager (husky, lefthook, or plain git). Prints CI setup snippets for GitHub Actions, GitLab CI, and generic CI.

---

### `inferwise estimate [path]`

Scan a directory for LLM API calls and estimate token costs.

```bash
inferwise estimate .
inferwise estimate ./src --volume 5000
inferwise estimate . --format json
inferwise estimate . --precise          # Use provider APIs for exact counts
```

| Flag | Default | Description |
|------|---------|-------------|
| `--volume <n>` | `1000` | Requests/day for monthly cost projection |
| `--format <table\|json\|markdown>` | `table` | Output format |
| `--precise` | off | Use provider APIs for exact token counts (requires API keys) |
| `--config <path>` | auto | Path to `inferwise.config.json` |

**Example output:**

```
File               Line  Provider   Model              Input    Output   Cost/Call  Monthly
src/chat.ts        42    anthropic  claude-sonnet-4    1,200    600      $0.0126    $378/mo
src/summarize.ts   18    openai     gpt-4o              800    400      $0.0064    $192/mo
src/rag.ts         91    anthropic  claude-opus-4      4,096 ≈  2,048 ≈  $0.0429    $1,287/mo
```

Token source markers:
- No marker — extracted from code (exact)
- `≈` — typical estimate (no static prompt or max_tokens found)
- `*` — worst-case ceiling from model spec
- `~` — calibrated from real provider usage data

See [HEURISTICS.md](HEURISTICS.md) for methodology and sources.

---

### `inferwise diff [path]`

Compare token costs between two git refs. Enforces budget policy automatically.

```bash
inferwise diff                              # Compare main vs HEAD
inferwise diff --base develop --head HEAD   # Custom refs
inferwise diff --volume 5000                # Higher volume projection
```

| Flag | Default | Description |
|------|---------|-------------|
| `--base <ref>` | `main` | Base git ref |
| `--head <ref>` | `HEAD` | Head git ref |
| `--volume <n>` | `1000` | Requests/day |
| `--format <table\|json\|markdown>` | `table` | Output format |
| `--fail-on-increase <amount>` | off | Exit 1 if monthly increase exceeds `$amount` |

**Budget enforcement:** If `inferwise.config.json` has `budgets.block` set and the cost delta exceeds it, `diff` exits with code 1 — blocking the merge in any CI system.

---

### `inferwise check [path]`

Verify total LLM costs are within budget. Exits with code 1 if any threshold is exceeded. Designed for AI agents and automation pipelines where there's no human reviewing a PR.

```bash
inferwise check .                                    # Uses budgets.block from config
inferwise check . --max-monthly-cost 10000           # Custom monthly limit
inferwise check . --max-cost-per-call 0.05           # Per-call limit
inferwise check . --max-monthly-cost 5000 --volume 5000
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-monthly-cost <amount>` | `budgets.block` from config | Max total monthly cost (USD) |
| `--max-cost-per-call <amount>` | off | Max cost per single LLM call (USD) |
| `--volume <n>` | `1000` | Requests/day |
| `--format <table\|json\|markdown>` | `table` | Output format |

Unlike `diff` (which compares branches), `check` validates the **absolute** cost of the current codebase. Use it as a gate before deploying — if the total projected cost exceeds the limit, the command fails.

---

### `inferwise calibrate [path]`

Fetch real usage data from provider APIs and compute correction factors. Makes future estimates significantly more accurate.

```bash
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-... inferwise calibrate .
OPENAI_API_KEY=sk-... inferwise calibrate . --provider openai
inferwise calibrate . --dry-run    # Preview without saving
```

| Flag | Default | Description |
|------|---------|-------------|
| `--provider <name>` | all | Calibrate only one provider |
| `--dry-run` | off | Show comparison without saving |
| `--days <n>` | `30` | Usage period to fetch |
| `--format <table\|json>` | `table` | Output format |

Stores correction ratios in `.inferwise/calibration.json`. Future `estimate` runs auto-load these and adjust typical/model-limit values. Only adjusts heuristic estimates — code-extracted values are already exact and left untouched.

---

### `inferwise audit [path]`

Find cost optimization opportunities: cheaper model alternatives, cacheable responses, batchable calls.

```bash
inferwise audit .
inferwise audit ./src --format markdown
```

---

### `inferwise price [provider] [model]`

Look up model pricing instantly. Designed for both humans and AI agents.

```bash
inferwise price anthropic claude-sonnet-4
inferwise price anthropic claude-sonnet-4 --input-tokens 2000 --output-tokens 1000
inferwise price --compare anthropic/claude-sonnet-4 openai/gpt-4o
inferwise price --list anthropic
inferwise price --list-all
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input-tokens <n>` | `1000` | Number of input tokens |
| `--output-tokens <n>` | `1000` | Number of output tokens |
| `--volume <n>` | `1000` | Requests/day for monthly projection |
| `--compare` | off | Compare multiple provider/model pairs |
| `--list <provider>` | — | List all models for a provider |
| `--list-all` | off | List all models across all providers |
| `--format <table\|json>` | `table` | Output format |

---

## Configuration

### `inferwise.config.json`

Create with `inferwise init` or manually:

```json
{
  "defaultVolume": 1000,
  "ignore": ["node_modules", "dist", "build", "test", "__tests__", "*.test.ts", "*.spec.ts"],
  "overrides": [
    {
      "pattern": "src/chat/**",
      "volume": 5000
    }
  ],
  "budgets": {
    "warn": 2000,
    "block": 50000,
    "requireApproval": 10000,
    "approvers": ["platform-eng", "@infra-team"]
  }
}
```

**Budget thresholds** (monthly cost increase in USD):

| Field | Default | Description |
|-------|---------|-------------|
| `warn` | `$2,000` | Warning in stderr (CLI) or yellow label on PR (GitHub Action) |
| `block` | `$50,000` | **Hard gate.** Exit code 1 (CLI) or red label + failed check (GitHub Action). Blocks merge in any CI. |
| `requireApproval` | — | **Soft gate, GitHub Action only.** Orange label + requests review from `approvers`. Does not fail CI — relies on branch protection rules to enforce. |
| `approvers` | — | GitHub teams or users who can approve over-budget PRs. Only used with `requireApproval`. |

Budget defaults are deliberately high — `block` is an emergency brake for catastrophic changes (wrong model at scale, missing max_tokens cap), not routine cost increases.

### Per-path volume overrides

Different endpoints have different traffic. A chat endpoint might handle 5,000 req/day while a batch summarizer runs 100/day:

```json
{
  "defaultVolume": 1000,
  "overrides": [
    { "pattern": "src/chat/**", "volume": 5000 },
    { "pattern": "src/batch/**", "volume": 100 }
  ]
}
```

---

## CI Setup

### GitHub Actions

```yaml
name: Inferwise Cost Diff
on: [pull_request]

jobs:
  cost-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: inferwise/inferwise-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The GitHub Action reads `inferwise.config.json` for budget thresholds and automatically:
- Posts a cost report comment on the PR
- Applies labels: `cost-warning` (yellow), `cost-approval-required` (orange), `cost-blocked` (red)
- Requests reviews from configured approvers when `requireApproval` is exceeded
- Fails the check when `block` is exceeded

### GitLab CI

```yaml
inferwise-check:
  stage: test
  script:
    - npx inferwise diff --format table
  rules:
    - if: $CI_MERGE_REQUEST_IID
```

### Bitbucket Pipelines

```yaml
pipelines:
  pull-requests:
    '**':
      - step:
          name: Cost Check
          script:
            - npx inferwise diff --format table
```

### Any CI (Jenkins, CircleCI, etc.)

```bash
npx inferwise diff --base main --head HEAD
# Exit code 1 if budgets.block is exceeded
```

The CLI is the enforcement engine. It works everywhere `npx` runs. The GitHub Action is a convenience wrapper that adds PR comments and labels.

---

## Estimation Accuracy

Inferwise uses static analysis — it reads your source code, not runtime traffic. Accuracy depends on what it can extract:

| Source | Marker | Accuracy | How |
|--------|--------|----------|-----|
| Code-extracted | (none) | Exact | Static prompts tokenized, `max_tokens` read from code |
| Typical estimate | `≈` | 2-5x of actual | Industry heuristics: 4K input tokens, 5% of max output |
| Model limit | `*` | 10-50x of actual | Worst-case ceiling from model spec |
| Calibrated | `~` | Within 20% | Corrected by real provider usage data |

**To improve accuracy:**
1. Set `max_tokens` in your LLM calls (gives exact output estimates)
2. Run `inferwise calibrate` with provider API keys (corrects heuristics with real data)
3. Use `--precise` flag for exact tokenization of static prompts

See [HEURISTICS.md](HEURISTICS.md) for full methodology, data sources, and assumptions.

---

## Supported Frameworks

| Framework | Detected Patterns | Notes |
|-----------|-------------------|-------|
| Anthropic SDK | `.messages.create()` | TS/JS and Python |
| OpenAI SDK | `.chat.completions.create()` | TS/JS and Python |
| Google GenAI SDK | `.generateContent()` | |
| xAI SDK | `.chat.completions.create()` | OpenAI-compatible; provider resolved from model ID (`grok-*`) |
| LangChain | `ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI`, `ChatXAI` | |
| Vercel AI SDK | `generateText`, `streamText`, `generateObject`, `streamObject` | Provider inferred from model factory |

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

---

## Pricing Database

The [`@inferwise/pricing-db`](packages/pricing-db) package ships bundled pricing for all supported providers, updated daily via automated sync.

```bash
npm install @inferwise/pricing-db
```

```typescript
import { getModel, calculateCost, getAllProviders } from "@inferwise/pricing-db";

const model = getModel("anthropic", "claude-sonnet-4-20250514");
const cost = calculateCost({ model, inputTokens: 1000, outputTokens: 500 });
console.log(`Cost: $${cost.toFixed(6)}`);
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INFERWISE_CONFIG` | Path to config file (overrides auto-discovery) |
| `INFERWISE_VOLUME` | Default daily request volume (overridden by `--volume`) |
| `ANTHROPIC_API_KEY` | Precise token counting (with `--precise`) |
| `OPENAI_API_KEY` | Precise token counting (with `--precise`) |
| `GOOGLE_API_KEY` | Precise token counting (with `--precise`) |
| `ANTHROPIC_ADMIN_API_KEY` | Real usage data for `inferwise calibrate` |

---

## Project Structure

```
inferwise/
├── packages/
│   ├── cli/              # inferwise CLI (Commander.js + tsup)
│   ├── pricing-db/       # @inferwise/pricing-db — bundled pricing JSON
│   └── github-action/    # GitHub Action for PR cost comments
├── scripts/              # Maintenance scripts (pricing sync)
├── HEURISTICS.md         # Estimation methodology and data sources
└── .github/workflows/    # CI, cost-diff, pricing sync, publish
```

---

## Development

**Requirements:** Node.js 18+, pnpm 9+

```bash
git clone https://github.com/inferwise/inferwise.git
cd inferwise
pnpm install
pnpm build
pnpm test        # 177 tests
pnpm lint
pnpm typecheck
```

---

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

**Quick start:** fork, branch, make changes, run `pnpm lint && pnpm build && pnpm typecheck && pnpm test`, open a PR.

**Pricing data corrections** are especially valuable — edit the JSON files in [`packages/pricing-db/providers/`](packages/pricing-db/providers/) and open a PR with evidence from the official pricing page.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

[inferwise.dev](https://inferwise.dev) · [GitHub](https://github.com/inferwise/inferwise) · [npm](https://www.npmjs.com/package/inferwise)
