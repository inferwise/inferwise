<p align="center">
  <img src="assets/banner.png" alt="Inferwise" width="120" />
</p>

# Inferwise

**Smart model selection and cost enforcement for LLM API calls.**

[![CI](https://github.com/inferwise/inferwise/actions/workflows/ci.yml/badge.svg)](https://github.com/inferwise/inferwise/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/inferwise)](https://www.npmjs.com/package/inferwise)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Inferwise scans your codebase for LLM API calls, recommends the cheapest model that can handle each task, estimates per-token costs, and enforces budget guardrails — from pre-commit to CI to merge. Whether a human or an AI agent wrote the code, nothing ships without cost visibility and the right model for the job.

---

## The $1,800/mo Example

An AI coding agent builds a RAG pipeline and picks Opus for every step — embeddings, retrieval, summarization, response generation. Those calls will run in production, billed per token to your API key.

**Without Inferwise:** The agent picks the most capable (and expensive) model for every call. The bill shows up after the code ships. **$2,400/mo.**

**With Inferwise MCP:** The agent calls `suggest_model` for each task — it learns that classification only needs `gpt-4o-mini`, summarization works fine on `claude-sonnet-4`, and only the reasoning step needs `claude-opus-4`. Cost drops to **$600/mo** before a single line ships.

**With Inferwise CI:** Even if the agent doesn't use MCP, `inferwise diff` flags "+$2,400/mo in new API costs" on the PR. The developer swaps models. Same result.

**$1,800/mo saved before a single line ships.**

---

## Quick Start

```bash
# See what your LLM calls cost
npx inferwise estimate .

# Get smart model recommendations
npx inferwise audit .

# Set up guardrails: config + git hooks + CI
npx inferwise init

# Compare costs between branches
npx inferwise diff
```

For AI agents — add the MCP server:

```bash
# Claude Code
claude mcp add inferwise -- npx -y @inferwise/mcp

# Cursor / VS Code / Windsurf — add to MCP settings:
{
  "mcpServers": {
    "inferwise": {
      "command": "npx",
      "args": ["-y", "@inferwise/mcp"]
    }
  }
}
```

Or install globally:

```bash
npm install -g inferwise
# or
pnpm add -g inferwise
```

---

## How It Works

Two problems, one tool.

**Wrong model selection.** Teams and agents pick models by name recognition, not by capability match. A classification task gets routed to Opus when `gpt-4o-mini` handles it fine — 90% cost difference for zero quality gain.

**No cost visibility.** Nobody knows what a model swap costs until the invoice arrives. Someone upgrades from Sonnet to Opus and nobody notices until month-end.

Inferwise addresses both:

- **Recommend:** `inferwise audit` and the MCP server analyze what each LLM call does, infer the required capabilities, and suggest the cheapest model that can handle the task — cross-provider, with reasoning.
- **Enforce:** Pre-commit hooks, CI gates, and budget policies catch expensive code before it ships. If the cost delta exceeds your threshold, the merge is blocked.

---

## How Model Selection Works

Inferwise infers what each LLM call needs by analyzing prompts in your code, then ranks alternatives using quality benchmarks from [Chatbot Arena](https://arena.ai/leaderboard):

1. **Capability inference.** Keywords in system/user prompts are matched to capabilities: `code`, `reasoning`, `general`, `creative`, `vision`, `search`, `audio`. This is regex-based pattern matching — fast and deterministic, not AI-powered. If no keywords match, it falls back to `general`.

2. **Quality-adjusted ranking.** Models are ranked by *value* (cost / quality), not just cost. Quality scores come from Chatbot Arena human preference rankings, normalized 0-100. A $5/M model with quality 90 beats a $2/M model with quality 40. Candidates must score ≥70% of the current model's quality — prevents recommending a budget model for a premium task.

3. **Confidence levels.** Based on what Inferwise can extract from code:
   - **High** — both system prompt and user prompt found → any tier drop, any provider
   - **Medium** — one prompt found → max 1 tier drop (premium→mid OK, premium→budget blocked)
   - **Low** — prompts are dynamic (variables, not string literals) → same provider, same tier only

4. **Minimum threshold.** Only suggests alternatives with >20% savings. No noise.

### Concrete Example

```
Your code:
  anthropic.messages.create({
    model: "claude-opus-4-20250514",
    system: "Classify tickets into: billing, technical, account",
    messages: [{ role: "user", content: ticket }],
  })

Inferwise analyzes:
  ✓ System prompt extracted → medium confidence
  ✓ No code/reasoning keywords → capability: [general]
  ✓ Opus 4 = premium tier, quality: 94/100, $75/M output

Candidates passing quality gate (general, quality ≥ 66):
  o3           mid tier, quality: 94, $8/M   → quality-adj: $8.51/M  ✓
  gpt-4.1      mid tier, quality: 90, $8/M   → quality-adj: $8.89/M  ✓
  gpt-4o       mid tier, quality: 77, $10/M  → quality-adj: $12.99/M ✓

Blocked by quality gate:
  flash-lite   budget, quality: 52 → 52/94 = 55% < 70% threshold ✗

Result:
  chat-service.ts:8  claude-opus-4 → o3 (openai)
    Use case: [general] (medium confidence)
    Savings: $527/mo — quality: 94 vs 94
```

Every model in the pricing database is tagged with its capabilities and quality benchmarks. See `packages/pricing-db/providers/` for pricing and `packages/pricing-db/benchmarks.json` for quality scores.

---

## End-to-End Pipeline

Every LLM API call in your codebase can pass through four tiers before it reaches production.

```
Code written (by human or AI agent)
        |
        v
  +-----------+
  |  TIER 0   |  Smart model selection (before/during code writing)
  |           |  MCP suggest_model / inferwise audit
  |           |  "Use gpt-4o-mini — classification doesn't need Opus"
  +-----+-----+
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
| Smart selection | MCP server / `inferwise audit` | Recommends cheapest capable model for each task |
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

**2. Audit existing code for optimization**

```bash
npx inferwise audit .
```

```
SMART MODEL ALTERNATIVES

  src/rag.ts:6 — claude-opus-4 → claude-sonnet-4 (anthropic)
    Use case: general (high confidence)
    Reason: Task requires [general] — Sonnet handles that at 79% savings
    Savings: $14,595/mo ($18,440 → $3,845)

  src/classify.ts:14 — gpt-4o → gpt-4o-mini (openai)
    Use case: general (medium confidence)
    Reason: Task requires [general] — gpt-4o-mini handles that at 90% savings
    Savings: $4,500/mo ($5,000 → $500)
```

Inferwise reads the prompts in your code, infers what each LLM call does, and recommends cheaper models that can handle the task. See [How Model Selection Works](#how-model-selection-works) for details.

**3. Write code with LLM API calls**

You (or an AI coding agent) write code that calls provider APIs. On `git commit`, the pre-commit hook runs automatically:

```
$ git commit -m "feat: add summarizer"

File               Line  Provider   Model           Cost/Call  Monthly
src/summarize.ts   18    openai     gpt-4o          $0.0064    $192/mo
src/rag.ts         91    anthropic  claude-opus-4   $0.0429    $1,287/mo

Total: $1,479/mo (at 1,000 req/day)
```

You see the cost impact before the code leaves your machine.

**4. Open a pull request**

CI runs `inferwise diff`. The GitHub Action posts a cost report directly on the PR:

| File | Model | Change | Monthly Impact |
|------|-------|--------|----------------|
| src/summarize.ts | (new) gpt-4o | Added | +$192/mo |
| src/rag.ts | claude-sonnet-4 -> claude-opus-4 | Upgrade | +$1,050/mo |

**Net: +$1,242/mo**

If the increase exceeds `budgets.block`, the PR is blocked from merging.

**5. Calibrate for tighter estimates (optional)**

```bash
ANTHROPIC_ADMIN_API_KEY=sk-ant-admin-... inferwise calibrate .
```

Fetches real usage data from provider APIs, computes correction ratios, and stores them locally. Future estimates go from "2-5x accuracy" to "within 20%".

---

### For AI Agents: MCP Server

The [`@inferwise/mcp`](packages/mcp-server) package gives AI agents direct access to Inferwise tools via the [Model Context Protocol](https://modelcontextprotocol.io). The agent can suggest models, estimate costs, and audit codebases without leaving its workflow.

```bash
# Claude Code
claude mcp add inferwise -- npx -y @inferwise/mcp

# Cursor / VS Code / Windsurf — add to MCP settings:
{
  "mcpServers": {
    "inferwise": {
      "command": "npx",
      "args": ["-y", "@inferwise/mcp"]
    }
  }
}
```

Once connected, the agent gets three tools:

| Tool | What It Does |
|------|-------------|
| `suggest_model` | Describe a task, get back the cheapest capable model with alternatives and reasoning |
| `estimate_cost` | Estimate the cost of an LLM API call given provider, model, and token counts |
| `audit` | Scan a directory for LLM API calls and suggest cheaper capable alternatives |

**Example flow:** An agent writing a classification pipeline calls `suggest_model` with task "classify support tickets by category" — Inferwise returns `gpt-4o-mini` at $0.60/MTok instead of `gpt-4o` at $10/MTok. The agent writes the code with the right model from the start. No human review needed.

The MCP server runs locally as a subprocess — no hosted infrastructure, no API keys needed. It communicates via stdio using JSON-RPC. Works with Claude Code, Cursor, VS Code (1.99+), Windsurf, Cline, and any MCP-compatible tool.

#### Programmatic Alternatives

For agents and pipelines that don't support MCP:

**SDK** — embed directly in agent pipelines:

```typescript
import { estimateAndCheck } from "inferwise/sdk";

const result = await estimateAndCheck("./src", { maxMonthlyCost: 10000, volume: 5000 });
if (!result.ok) console.error("Over budget:", result.violations);
```

**CLI** — tool-use for agents and scripts:

```bash
inferwise check . --max-monthly-cost 10000 --format json
inferwise price openai gpt-4o --input-tokens 2000 --output-tokens 1000 --format json
```

**Pricing database** — for model routers and cost-aware selection:

```typescript
import { suggestModelForTask, calculateCost, getModel } from "@inferwise/pricing-db";

const suggestion = suggestModelForTask("classify support tickets");
const cost = calculateCost({ model: suggestion.model, inputTokens: 2000, outputTokens: 500 });
```

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

## What Ships: Four Packages

| Package | Who Uses It | What It Does |
|---------|------------|--------------|
| [`inferwise`](https://www.npmjs.com/package/inferwise) | Developers, CI, AI agents | CLI + SDK — scan, estimate, diff, check, audit, enforce budgets |
| [`@inferwise/pricing-db`](packages/pricing-db) | Model routers, cost-aware apps | Bundled pricing for 35+ models across 5 providers, capability-based model selection, updated daily |
| [`@inferwise/mcp`](packages/mcp-server) | AI agents (Claude Code, Cursor, VS Code, Windsurf) | MCP server — suggest models, estimate costs, audit codebases as AI agent tools |
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

Find cost optimization opportunities with smart, capability-aware recommendations. Infers what each LLM call does from the prompts in your code, then suggests cheaper models that can handle the task — with reasoning. See [How Model Selection Works](#how-model-selection-works) for the methodology.

```bash
inferwise audit .
inferwise audit ./src --format markdown
inferwise audit . --format json
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

**Direct provider SDKs:**

| Framework | Detected Patterns | Notes |
|-----------|-------------------|-------|
| Anthropic SDK | `.messages.create()` | TS/JS and Python |
| OpenAI SDK | `.chat.completions.create()` | TS/JS and Python |
| Google GenAI SDK | `.generateContent()` | |
| xAI SDK | `.chat.completions.create()` | OpenAI-compatible; provider resolved from model ID (`grok-*`) |
| Perplexity SDK | `.chat.completions.create()` | OpenAI-compatible; provider resolved from model ID (`sonar-*`) |

**Cloud-hosted providers:**

| Platform | Detected Patterns | Provider Resolution |
|----------|-------------------|---------------------|
| AWS Bedrock (boto3) | `invoke_model()`, `invoke_model_with_response_stream()` | Resolved from `modelId` (e.g., `anthropic.claude-sonnet-4` → Anthropic) |
| AWS Bedrock (LangChain) | `ChatBedrock`, `ChatBedrockConverse` | Resolved from model ID |
| Azure OpenAI (SDK) | `new AzureOpenAI()` + `.chat.completions.create()` | → OpenAI |
| Azure OpenAI (LangChain) | `AzureChatOpenAI` | → OpenAI |
| LiteLLM | `litellm.completion()`, `litellm.acompletion()` | Resolved from model prefix (`bedrock/`, `azure/`, `vertex_ai/`) |

**Abstraction frameworks:**

| Framework | Detected Patterns | Notes |
|-----------|-------------------|-------|
| LangChain | `ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI`, `ChatXAI` | |
| Vercel AI SDK | `generateText`, `streamText`, `generateObject`, `streamObject` | Provider inferred from model factory |

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

**Cloud pricing note:** Inferwise maps cloud-hosted calls (Bedrock, Azure, Vertex AI) to the underlying provider's direct API pricing. Cloud platforms may charge different per-token rates than the direct API. Estimates for cloud-hosted calls should be treated as a baseline — actual costs may vary depending on your cloud provider agreement.

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
│   ├── mcp-server/       # @inferwise/mcp — MCP server for AI agent tools
│   └── github-action/    # GitHub Action for PR cost comments
├── scripts/              # Maintenance scripts (pricing sync, benchmark sync)
├── HEURISTICS.md         # Estimation methodology and data sources
└── .github/workflows/    # CI, cost-diff, pricing sync, benchmark sync, publish
```

---

## Development

**Requirements:** Node.js 18+, pnpm 9+

```bash
git clone https://github.com/inferwise/inferwise.git
cd inferwise
pnpm install
pnpm build
pnpm test
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
