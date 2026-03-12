# Inferwise — Product Specification

## Overview

Inferwise is a FinOps platform for **pay-as-you-go LLM API costs** — the per-token charges incurred when your application code calls provider APIs (Anthropic, OpenAI, Google, xAI, Perplexity). It does not track flat-rate subscriptions (Claude Code, Cursor, Copilot, ChatGPT Plus, etc.).

**Website:** inferwise.dev
**GitHub:** github.com/inferwise
**npm:** inferwise

## Scope

**In scope:** Code that calls LLM APIs and gets billed per token — `messages.create()`, `chat.completions.create()`, `generateContent()`, LangChain wrappers, Vercel AI SDK calls. These run in your production, hit your API key, and scale with traffic.

**Out of scope:** Flat-rate AI tool subscriptions (Claude Code, Cursor Pro, GitHub Copilot, ChatGPT Plus/Team, Codex). These are fixed monthly costs regardless of usage — there's nothing to estimate or gate.

**The connection:** AI coding tools (Cursor, Claude Code, Codex) may *generate* code that makes LLM API calls. Inferwise catches those API calls at commit time, not the subscription cost of the tool that wrote them.

## What This Repo Contains

1. **CLI** (`inferwise`) — Pre-commit API cost estimation, budget enforcement, calibration
2. **Pricing Database** (`@inferwise/pricing-db`) — Bundled provider API pricing, updated daily, with capability-based model selection
3. **MCP Server** (`@inferwise/mcp`) — AI agent tools via Model Context Protocol (suggest models, estimate costs, audit codebases)
4. **GitHub Action** (`inferwise/inferwise-action`) — PR cost diff comments + budget enforcement in CI

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| CLI | TypeScript, Commander.js, tsup |
| Backend API | Hono on Cloudflare Workers (Railway for dev) |
| Database | Supabase (Postgres + Auth + Realtime) |
| Frontend | React + Vite + Tailwind CSS |
| Proxy | Cloudflare Workers |
| CI/CD | GitHub Actions (primary), GitLab CI (secondary) |
| Package Manager | pnpm |
| Testing | Vitest |
| Linting | Biome |

---

## Project Structure

```
inferwise/
├── packages/
│   ├── cli/                    # npm package: inferwise
│   │   └── src/
│   │       ├── commands/       # init, estimate, diff, audit, fix, price, calibrate, update-pricing
│   │       ├── scanners/       # Regex-based LLM API call detection
│   │       ├── tokenizers/     # Provider tokenizer wrappers
│   │       ├── formatters/     # table, markdown, JSON output
│   │       ├── providers/      # Provider usage API clients (calibrate) — Anthropic, OpenAI, OpenRouter
│   │       ├── calibration.ts  # Calibration schema, load/save, ratio math
│   │       ├── fix-core.ts     # Auto-fix: model swap logic shared by CLI + MCP
│   │       ├── telemetry-client.ts # OTel telemetry client (Grafana Tempo, Prometheus, legacy)
│   │       ├── config.ts       # Config schema (budgets, overrides, volumes, telemetry)
│   │       └── index.ts        # CLI entry point
│   ├── pricing-db/             # @inferwise/pricing-db
│   │   ├── providers/
│   │   │   ├── anthropic.json
│   │   │   ├── openai.json
│   │   │   ├── google.json
│   │   │   ├── xai.json
│   │   │   └── perplexity.json
│   │   ├── schema.json
│   │   ├── benchmarks.json          # Quality scores from Chatbot Arena
│   │   ├── benchmarks.schema.json
│   │   └── src/index.ts
│   ├── mcp-server/             # @inferwise/mcp — MCP server for AI agents
│   │   └── src/
│   │       ├── index.ts        # Server entry point (stdio transport)
│   │       └── tools/          # suggest-model, estimate-cost, audit, apply-recommendations
│   └── github-action/
│       ├── action.yml
│       └── src/index.ts
├── scripts/                    # Maintenance scripts (pricing sync, benchmark sync)
├── HEURISTICS.md               # Estimation methodology and data sources
├── .github/workflows/          # CI, cost-diff, pricing sync, benchmark sync, publish
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── biome.json
```

---

## CLI Commands

### `inferwise init`

Set up Inferwise in a project. Creates `inferwise.config.json`, installs git hooks, prints CI setup instructions.

**Flags:**
- `--no-hooks` — Skip git hook installation
- `--no-config` — Skip config file creation
- `--hook <type>` — Hook type: `pre-commit` (default) or `pre-push`

**Behavior:**
- Auto-detects hook manager (husky, lefthook, or plain git)
- Prints CI setup snippets for GitHub Actions, GitLab CI, and generic CI
- Creates config with budget defaults: warn $2,000/mo, block $50,000/mo

### `inferwise estimate [path]`

Scan a directory for LLM API calls and estimate costs.

**Output columns:** File, Line, Provider, Model, Input Tokens (est), Output Tokens (est), Cost/Call, Monthly Cost

**Flags:**
- `--volume <n>` — Requests/day for monthly projection (default: 1000)
- `--format <table|json|markdown>` — Output format (default: table)
- `--config <path>` — Path to inferwise.config.json

**Unknown model detection:** When the scanner finds a model ID that doesn't exist in the pricing database, a warning is printed with the missing model ID and a link to the issue tracker.

### `inferwise diff [path]`

Compare token costs between two git refs. Enforces budget policy from config.

**Output:** Side-by-side diff showing old vs new cost per call site with net monthly impact.

**Flags:**
- `--base <ref>` — Base git ref (default: main)
- `--head <ref>` — Head git ref (default: HEAD)
- `--volume <n>` — Requests/day
- `--format <table|json|markdown>`
- `--fail-on-increase <amount>` — Exit 1 if monthly increase exceeds threshold

**Budget enforcement:** If `budgets.block` is set in config and the net monthly delta exceeds it, exits with code 1. If `budgets.warn` is exceeded, prints a warning to stderr.

### `inferwise calibrate [path]`

Fetch real usage data from provider APIs and compute correction factors for more accurate estimates.

**Flags:**
- `--provider <name>` — Calibrate only one provider (e.g. `anthropic`, `openai`, `openrouter`)
- `--dry-run` — Show comparison without saving
- `--days <n>` — Usage period (default: 30)
- `--format <table|json>` — Output format (default: table)
- `--config <path>` — Config file path

**Behavior:**
- Fetches actual token usage from provider APIs
- Compares actual vs estimated per model, computes correction ratios
- Stores ratios in `.inferwise/calibration.json`
- Future `estimate` runs auto-load calibration and adjust typical/model-limit values
- Only adjusts heuristic estimates — code-extracted values are left untouched

**Provider APIs:**
- Anthropic: `ANTHROPIC_ADMIN_API_KEY` → Admin API usage reports
- OpenAI: `OPENAI_API_KEY` → Usage API completions endpoint
- OpenRouter: `OPENROUTER_API_KEY` → Activity API (covers ALL providers in one call)
- Google/xAI/Perplexity: No direct usage API — use `--provider openrouter` to calibrate via OpenRouter

**OpenRouter calibration:** If `OPENROUTER_API_KEY` is set, `inferwise calibrate` automatically fetches usage data from OpenRouter for any providers that lack direct APIs (Google, xAI, Perplexity). Use `--provider openrouter` to calibrate exclusively from OpenRouter data.

### `inferwise check [path]`

Verify total LLM costs are within budget. Exits with code 1 if any threshold is exceeded. Designed for CI pipelines and pre-commit hooks where automated pass/fail is needed.

**Flags:**
- `--max-monthly-cost <amount>` — Max total monthly cost (USD). Defaults to `budgets.maxMonthlyCost` from config, then `budgets.block` for backward compatibility.
- `--max-cost-per-call <amount>` — Max cost per single LLM call (USD)
- `--volume <n>` — Requests/day for monthly projection (default: 1000)
- `--format <table|json|markdown>` — Output format (default: table)

Unlike `diff` (which compares branches), `check` validates the **absolute** cost of the current codebase. The `init` command's pre-commit hook uses `check` by default.

### `inferwise audit [path]`

Scan for cost optimization opportunities. Produces three types of findings:

**Smart model alternatives:** For each LLM call site, combines extracted system/user prompts and runs keyword-based capability inference (`inferRequiredCapabilities` from pricing-db) to determine what the call needs (`code`, `reasoning`, `general`, `creative`, `vision`, `search`, `audio`). Calls `suggestAlternatives` to find cheaper cross-provider models with the required capabilities. Confidence: both prompts = `high`, one = `medium`, dynamic = `low`. Low confidence restricts to same-provider. Only shows alternatives with >20% savings.

**Prompt caching opportunities:** Detects repeated system prompts across multiple call sites that could benefit from provider caching APIs.

**Batch API opportunities:** Identifies non-latency-sensitive call sites that could use batch API pricing.

### `inferwise fix [path]`

Auto-apply model swap recommendations from audit. Rewrites model IDs in source files.

**Flags:**
- `--dry-run` — Preview changes without modifying files
- `--provider <name>` — Only fix models from this provider
- `--min-savings <amount>` — Minimum monthly savings to apply a fix (USD, default: 0)
- `--volume <n>` — Requests/day for monthly projection (default: 1000)
- `--format <table|json>` — Output format (default: table)
- `--config <path>` — Path to inferwise.config.json

**Behavior:**
- Runs `detectSmartAlternatives()` on the codebase (same analysis as `audit`)
- For each recommendation, finds the model string literal on the target line
- Replaces the model ID in-place, preserving quote style (double, single, or backtick)
- Processes multiple swaps per file bottom-to-top so line numbers don't shift
- Skips dynamic models (variables, not string literals) and reports why
- Reports applied swaps, skipped swaps with reasons, and estimated monthly savings

**MCP equivalent:** The `apply_recommendations` MCP tool provides the same functionality for AI agents. It accepts explicit swaps (cherry-picked from audit) or runs audit internally when no recommendations are provided.

### `inferwise price [provider] [model]`

Look up model pricing. Designed for both humans and AI agents.

**Flags:**
- `--input-tokens <n>` / `--output-tokens <n>` — Token counts for cost calculation
- `--volume <n>` — Requests/day for monthly projection
- `--compare` — Compare multiple provider/model pairs
- `--list <provider>` / `--list-all` — List available models
- `--format <table|json>` — Output format

### `inferwise update-pricing`

Check the freshness of the bundled pricing database.

---

## Configuration File

`inferwise.config.json` in project root (created by `inferwise init`):

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
  },
  "telemetry": {
    "backend": "grafana-tempo",
    "endpoint": "https://tempo.internal:3200",
    "headers": { "X-Scope-OrgID": "my-org" },
    "apiKey": "glsa_..."
  }
}
```

**Note:** Volume overrides match at the **file level**, not the call-site level. If a single file contains multiple LLM calls with different expected traffic, split them into separate files or use the higher volume for conservative estimates.

### Budget Thresholds

Monthly cost increase (USD) that triggers enforcement actions:

| Field | Default | Description |
|-------|---------|-------------|
| `warn` | `2000` | Post a warning label/comment on PRs |
| `block` | `50000` | Fail CI check, block merge. Emergency brake — only fires on catastrophic changes |
| `requireApproval` | — | Request review from `approvers` before merge |
| `approvers` | — | GitHub teams or users who can approve over-budget PRs |
| `maxMonthlyCost` | — | **Absolute** total monthly cost cap (USD) for `check` command. Unlike `block` (which gates on cost *increase* between refs), this is a ceiling on the total projected spend of the codebase. |

`warn`, `block`, and `requireApproval` are **delta-based** — they compare the cost difference between two git refs (used by `diff` and the GitHub Action). `maxMonthlyCost` is **absolute** — it caps the total projected monthly cost of the entire codebase (used by `check`). If `maxMonthlyCost` is not set, `check` falls back to `block` for backward compatibility.

Defaults are deliberately high. `block` is meant to catch catastrophic mistakes (wrong model at scale, missing max_tokens cap), not routine cost increases. Teams should tune thresholds to their own spending patterns.

### Schema

```typescript
const configSchema = z.object({
  defaultVolume: z.number().positive().optional(),
  ignore: z.array(z.string()).optional(),
  overrides: z.array(z.object({
    pattern: z.string(),
    volume: z.number().positive().optional(),
  })).optional(),
  budgets: z.object({
    warn: z.number().min(0).optional(),
    block: z.number().min(0).optional(),
    requireApproval: z.number().min(0).optional(),
    approvers: z.array(z.string()).optional(),
    maxMonthlyCost: z.number().min(0).optional(),
  }).optional(),
  telemetry: z.object({
    backend: z.enum(["otlp", "grafana-tempo", "inferwise-cloud"]),
    endpoint: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    apiKey: z.string().optional(),
  }).optional(),
  /** @deprecated Use telemetry.endpoint instead. */
  apiUrl: z.string().url().optional(),
  /** @deprecated Use telemetry.apiKey instead. */
  apiKey: z.string().optional(),
});
```

---

## Pricing Database Schema

```json
{
  "provider": "anthropic",
  "last_verified": "2026-03-09",
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      "input_cost_per_million": 3.00,
      "output_cost_per_million": 15.00,
      "cache_read_input_cost_per_million": 0.30,
      "cache_write_input_cost_per_million": 3.75,
      "context_window": 200000,
      "max_output_tokens": 16384,
      "supports_vision": true,
      "supports_tools": true,
      "supports_prompt_caching": true,
      "tier": "mid",
      "capabilities": ["code", "reasoning", "general", "creative"]
    }
  ]
}
```

Note: `tier` is auto-derived from pricing data by `computeTier()` in the pricing-db package.

Always validate against `packages/pricing-db/schema.json` when updating pricing files.

---

## Token Estimation Strategy

Token counts are derived from code extraction, typical heuristics, or model spec data.

**Input tokens (priority order):**
1. Static prompt found in code → tokenized for exact count (source: `code`)
2. Production stats from telemetry backend (≥10 requests) → real average (source: `production`)
3. Dynamic prompt → typical estimate of 4,096 tokens (source: `typical`)
4. Calibrated → typical adjusted by provider usage data (source: `calibrated`)
5. Unknown model → cheapest current model for the provider used as floor

**Output tokens (priority order):**
1. `max_tokens` / `maxTokens` / `max_output_tokens` extracted from code → exact (source: `code`)
2. Production stats from telemetry backend (≥10 requests) → real average (source: `production`)
3. Dynamic → 5% of model's `max_output_tokens`, clamped to [512, 4096] (source: `typical`)
4. Calibrated → typical adjusted by provider usage data (source: `calibrated`)
5. Unknown model → cheapest current model for the provider used as floor

> **Note:** The `model_limit` source (`context_window - max_output_tokens` for input, `max_output_tokens` for output) is not a direct fallback in the estimation pipeline — `typical` heuristics always fire first when model pricing data exists. `model_limit` only appears as a calibration-adjustable source tag when calibration data is applied.

**Typical heuristics rationale:**
- 4,096 input tokens: median observed across Anthropic docs, Helicone analytics, LangSmith traces
- 5% of max output (clamped [512, 4096]): most completions use a small fraction of available output
- See [HEURISTICS.md](HEURISTICS.md) for full methodology, data sources, and accuracy expectations

**TokenSource tracking:** Every estimate is tagged with its source:

| Source | Marker | Accuracy | Description |
|--------|--------|----------|-------------|
| `code` | (none) | Exact | Extracted from static prompts or max_tokens in code |
| `typical` | `≈` | 2-5x | Industry-standard heuristic estimate |
| `calibrated` | `~` | Within 20% | Adjusted by real provider usage data |
| `model_limit` | `*` | 10-50x | Worst-case ceiling from model spec |
| `production` | `†` | Within 10% | OTel telemetry (Grafana Tempo, Prometheus, or legacy Inferwise Cloud) |

**Tokenizer implementations:**

| Provider | Tokenizer | Notes |
|----------|-----------|-------|
| OpenAI (GPT-4o, GPT-4.1, o3, o4-mini, etc.) | `tiktoken` with native model encoding | Exact — OpenAI publishes their tokenizer |
| Anthropic (Claude Opus, Sonnet, Haiku) | `cl100k_base` approximation | ±5% — Anthropic does not publish a tokenizer |
| Google (Gemini 2.5 Pro, Flash, etc.) | `cl100k_base` approximation | Google does not publish a tokenizer |
| xAI (Grok 3, Grok 3 Mini, etc.) | `cl100k_base` approximation | xAI does not publish a tokenizer |

- **Unified interface:** `countTokens(provider, model, text): number`
- Non-OpenAI providers all use the same `cl100k_base` encoding from `tiktoken` as a best-available approximation. No unvalidated correction factors are applied.

---

## Calibration System

Calibration bridges the gap between heuristic estimates and real-world usage.

### How It Works

1. User runs `inferwise calibrate .` with provider API keys
2. CLI scans codebase (same as `estimate`) to get estimated token counts per model
3. CLI fetches actual usage from provider APIs (configurable period, default 30 days)
4. Compares estimated vs actual per model → computes correction ratios
5. Stores ratios in `.inferwise/calibration.json`
6. Future `estimate` runs auto-load calibration and adjust values

### Calibration Data Schema

```typescript
interface ModelCalibration {
  inputRatio: number;          // actual / estimated (e.g. 0.12 = actual is 12% of ceiling)
  outputRatio: number;
  sampleSize: number;          // request count from provider
  confidence: "low" | "medium" | "high";  // <100 / <1000 / ≥1000
  actualAvgInput: number;
  actualAvgOutput: number;
  estimatedAvgInput: number;
  estimatedAvgOutput: number;
}

interface CalibrationData {
  version: 1;
  calibratedAt: string;        // ISO 8601
  models: Record<string, ModelCalibration>;  // "provider/model-id"
}
```

### Application Rules

- Only adjusts `typical` and `model_limit` source values
- `code`-extracted values are already exact and left untouched
- Calibrated values tagged as `"calibrated"` source, displayed with `~` marker

### OpenRouter Calibration

OpenRouter is a unified LLM proxy that tracks per-model token usage across all providers. By adding `OPENROUTER_API_KEY`, users get calibration data for providers that lack direct usage APIs:

```bash
# Calibrate all providers via OpenRouter
OPENROUTER_API_KEY=sk-or-... inferwise calibrate .

# OpenRouter-only calibration
inferwise calibrate . --provider openrouter
```

OpenRouter Activity API returns per-model, per-day usage data. Inferwise maps OpenRouter provider names (e.g. "Anthropic", "Google AI Studio", "Vertex AI") to Inferwise provider IDs and strips the `provider/` prefix from model IDs (e.g. `anthropic/claude-sonnet-4` → `claude-sonnet-4`).

When `OPENROUTER_API_KEY` is set alongside direct provider keys (e.g. `ANTHROPIC_ADMIN_API_KEY`), OpenRouter data is used as a fallback for providers without direct APIs. Direct provider APIs take precedence when available.

---

## Telemetry System

Inferwise can fetch real production token usage from OTel-compatible backends to provide the most accurate estimates (`"production"` source, `†` marker).

### How It Works

Configure a telemetry backend in `inferwise.config.json`:

```json
{
  "telemetry": {
    "backend": "grafana-tempo",
    "endpoint": "https://tempo.internal:3200",
    "headers": { "X-Scope-OrgID": "my-org" },
    "apiKey": "glsa_..."
  }
}
```

When `inferwise estimate` runs and a telemetry backend is configured, it queries for real token usage data per model. If a model has ≥10 requests in the telemetry data, those averages are used instead of heuristic estimates.

### Supported Backends

| Backend | Config value | Query method | What it reads |
|---------|-------------|-------------|---------------|
| Grafana Tempo | `grafana-tempo` | Tempo search API | GenAI semantic convention spans (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`) |
| OTLP / Prometheus | `otlp` | PromQL queries | `gen_ai_client_token_usage` histogram metrics |
| Inferwise Cloud | `inferwise-cloud` | REST API (`/v1/stats`) | Legacy proprietary format |

### OTel GenAI Semantic Conventions

Inferwise reads the standard [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

| OTel Attribute | Inferwise Use |
|---|---|
| `gen_ai.provider.name` | Provider (anthropic, openai, etc.) |
| `gen_ai.request.model` | Requested model ID |
| `gen_ai.response.model` | Actual model used (preferred over request.model) |
| `gen_ai.usage.input_tokens` | Input token count per request |
| `gen_ai.usage.output_tokens` | Output token count per request |

Users instrument their LLM calls with standard OTel SDKs (many already do for general observability). Inferwise reads the existing traces/metrics — no custom telemetry pipeline needed.

### Backward Compatibility

The legacy `apiUrl` + `apiKey` config fields still work and are mapped to the `inferwise-cloud` backend internally. New deployments should use the `telemetry` config field.

### Source Priority with Telemetry

When telemetry data is available:
1. **Code-extracted** values (static prompts, `max_tokens`) always take priority
2. **Production stats** from telemetry (≥10 requests) override typical heuristics
3. **Calibration** ratios are applied to typical/model_limit values only
4. If both production stats and calibration exist, production stats win

---

## Code Scanner Strategy

Regex-based pattern matching (not AST parsing) for speed.

**Detected patterns:**

| Provider | SDK / Framework | Patterns | Notes |
|----------|----------------|----------|-------|
| Anthropic | Anthropic SDK (TS/JS/Python) | `.messages.create()` | |
| OpenAI | OpenAI SDK (TS/JS/Python) | `.chat.completions.create()` | |
| Google | Google GenAI SDK | `.generateContent()` | |
| xAI | OpenAI-compatible SDK | `.chat.completions.create()` | Same pattern as OpenAI; provider resolved from model ID (e.g., `grok-3` → xAI) |
| Perplexity | OpenAI-compatible SDK | `.chat.completions.create()` | Same pattern as OpenAI; provider resolved from model ID (e.g., `sonar-pro` → Perplexity) |
| Anthropic | LangChain | `new ChatAnthropic()` | |
| OpenAI | LangChain | `new ChatOpenAI()` | |
| Google | LangChain | `new ChatGoogleGenerativeAI()` | |
| xAI | LangChain | `new ChatXAI()` | |
| Inferred | Vercel AI SDK | `generateText()`, `streamText()`, `generateObject()`, `streamObject()` | Provider inferred from model factory, e.g., `anthropic("claude-sonnet-4")` → Anthropic |

**Extract per call:**
- File path + line number
- Provider + model name
- System prompt (if statically defined)
- User prompt / template (if statically defined)
- `max_tokens` / `maxTokens` / `max_output_tokens` / `maxOutputTokens` (if present)
- Dynamic flag: true when model or prompts are not statically resolvable

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.mjs`, `.cjs`

**Scanner limitations:**
- Context window is 3 lines before + 20 lines after the API call. Model, prompt, or `max_tokens` defined farther away won't be extracted.
- Prompt extraction captures up to 500 characters of inline string literals. Template literals with interpolation, multi-line prompts, or prompts stored in variables are marked as dynamic.
- Only the first matching pattern per line is used — multiple API calls on the same line are not supported.
- Dynamic calls (where model or prompts can't be statically resolved) use typical heuristic estimates. Run `inferwise calibrate` to correct these with real usage data.

---

## Three-Tier Enforcement

Inferwise enforces cost governance at three levels:

### 1. Pre-commit hooks (developer machine)

Installed by `inferwise init`. Runs `inferwise estimate .` before every commit. Shows cost impact before code leaves the developer's machine.

### 2. CI required check (merge gate)

Works with any CI system:
- **GitHub Actions** — `inferwise/inferwise-action@v1` posts comments, applies labels, blocks merge
- **GitLab CI** — `npx inferwise diff --format table` in a pipeline step
- **Bitbucket/Jenkins/any** — `npx inferwise diff` exits with code 1 if budget exceeded

### 3. Budget policy (organizational governance)

`inferwise.config.json` with `budgets` field — committed to the repo, code-reviewed, enforced automatically. The config file is the policy. No external dashboard or admin panel needed.

### GitHub Action Enforcement

The GitHub Action reads `inferwise.config.json` and applies:

| Threshold | Label | Action |
|-----------|-------|--------|
| `warn` | `cost-warning` (yellow) | Warning in PR comment |
| `requireApproval` | `cost-approval-required` (orange) | Requests review from `approvers` |
| `block` | `cost-blocked` (red) | Fails the check, blocks merge |

---

## Dependencies

**Use:**
- `commander` — CLI framework
- `tiktoken` — Token counting
- `chalk` — Terminal colors
- `cli-table3` — Terminal tables
- `glob` — File pattern matching
- `simple-git` — Git ops for diff command
- `zod` — Schema validation

**Avoid:**
- No Ink or Oclif (CLI)
- No Prettier or ESLint (use Biome)
- No Jest (use Vitest)
- No Webpack (use tsup)
- No yarn or npm (use pnpm)

---

## Environment Variables

```
ANTHROPIC_ADMIN_API_KEY=      # Calibration (Anthropic Admin API)
OPENAI_API_KEY=               # Calibration (OpenAI Usage API)
OPENROUTER_API_KEY=           # Calibration via OpenRouter (all providers in one call)
INFERWISE_CONFIG=             # Config file path override
INFERWISE_VOLUME=             # Default daily request volume
```

---

## Current Status

Phase 1 is complete and published (v0.3.0):

1. Pricing database package with all provider JSON files (35+ models, cross-validated in CI)
2. Capability-based model selection (`inferRequiredCapabilities`, `suggestModelForTask`, `suggestAlternatives`)
3. Tokenizer wrappers (unified `countTokens` interface)
4. Code scanner (regex pattern matching, 5 providers + LangChain + Vercel AI SDK + Bedrock + Azure + LiteLLM)
5. `inferwise estimate` command with typical heuristics
6. `inferwise diff` command with budget enforcement
7. `inferwise audit` command with smart, capability-aware model recommendations
8. `inferwise price` command
9. `inferwise init` command (config + hooks + CI setup)
10. `inferwise calibrate` command (provider API correction factors)
11. `inferwise check` command for AI agents and automation pipelines
12. Budget enforcement system (warn, block, requireApproval)
13. GitHub Action (PR comments, labels, reviewer requests, merge blocking)
14. MCP Server (`@inferwise/mcp`) for AI agent integration (suggest_model, estimate_cost, audit tools)
15. SDK entry point (`inferwise/sdk`) with `estimate()` and `estimateAndCheck()`
16. Published to npm as `inferwise`, `@inferwise/pricing-db`, `@inferwise/mcp`
17. OpenTelemetry integration — production stats from Grafana Tempo, Prometheus/OTLP, or legacy Inferwise Cloud
18. OpenRouter calibration provider — calibrate all providers in one command via OpenRouter Activity API
19. `inferwise fix` command — auto-apply model swap recommendations to source files
20. MCP `apply_recommendations` tool — AI agents can auto-fix expensive models programmatically

---

## Design Principles

- **Accuracy over speed.** A wrong estimate erodes trust. Use typical heuristics over worst-case ceilings. Show the source of every number.
- **Zero config to start.** `npx inferwise estimate .` works without setup.
- **Progressive disclosure.** Simple output by default, detailed with flags. Calibration for teams that want tighter numbers.
- **Offline-first CLI.** Pricing database is bundled. No API calls for basic estimation.
- **Platform-agnostic.** CLI + config file is the enforcement path. GitHub Action is a convenience wrapper. Works with any CI system.
- **Multi-provider always.** Never optimize for one provider.
- **Safe defaults.** Budget thresholds are high enough to never false-block legitimate workloads. Better to miss a warning than block production.

---

## PR Comment Format

```markdown
## Inferwise Cost Report

| File | Model | Change | Cost/Call | Monthly Impact |
|------|-------|--------|-----------|----------------|
| src/chat.ts | claude-opus-4 → claude-sonnet-4 | Downgrade | -$0.045 | -$13,500/mo |
| src/summarize.ts | (new) gpt-4o | Added | +$0.008 | +$2,400/mo |

**Net monthly impact: -$11,100/mo**

> Estimates based on 1,000 requests/day. Configure with `inferwise.config.json`.
> Powered by [Inferwise](https://inferwise.dev)
```

---

## Tone and Voice

- Documentation: direct, concise, no fluff. Like Stripe docs.
- Error messages: helpful and actionable. What to do, not just what went wrong.
- CLI output: clean, scannable. Minimal color. No emoji in default output.
