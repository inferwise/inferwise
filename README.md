# Inferwise

**Know and control your LLM costs before they ship.**

[![CI](https://github.com/inferwise/inferwise/actions/workflows/ci.yml/badge.svg)](https://github.com/inferwise/inferwise/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/inferwise)](https://www.npmjs.com/package/inferwise)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Inferwise is a FinOps CLI for LLM inference costs. It scans your codebase for LLM API calls, estimates token costs, and shows cost diffs in pull requests — before a single line ships.

---

## Quick Start

No install required:

```bash
npx inferwise estimate .
```

Or install globally:

```bash
npm install -g inferwise
# or
pnpm add -g inferwise
```

---

## Why Inferwise?

Your LLM bill is climbing and you're not sure why. You hit your API rate limit last Tuesday. Someone on the team swapped `gpt-4o-mini` for `claude-opus-4` and nobody noticed until the invoice arrived. You're shipping features faster than ever — but every new endpoint is another open tab on a credit card you can't see.

**This is LLM cost anxiety.** You know you're spending, but you don't know where, how much, or whether it's worth it. And unlike cloud infrastructure where you can check a dashboard before deploying, there's no cost visibility built into the LLM development workflow. The bill shows up after the code ships.

Inferwise fixes this. One command tells you what every LLM call in your codebase costs — before you commit, before you merge, before it hits production.

### Who This Is For

**Developers building LLM-powered features.** You're adding a summarization endpoint, a chat interface, or a RAG pipeline. You pick a model, write the integration, and ship it. But do you know the per-call cost? The monthly projection at 1,000 requests/day? At 10,000? Inferwise shows you before you commit.

**Teams hitting spending limits.** Your Anthropic or OpenAI bill doubled last month. You're not sure which endpoint is responsible. One team member upgraded a model for "better quality" and the monthly bill jumped $5,000. Nobody caught it in code review because there's no cost diff in the PR. Inferwise adds that missing layer.

**AI coding agents.** When tools like Cursor, Claude Code, Copilot, or Codex generate code, they optimize for correctness — not cost. They'll reach for `claude-opus-4` on every call because it's the most capable. Without a cost gate, expensive model choices ship silently into production.

### How It Works

```
 WHO WRITES THE CODE                     WHAT CALLS THE LLMs
 ────────────────────                    ──────────────────────
 Developers                              Chatbots / Support Agents
 AI Coding Agents (Cursor, Codex...)     RAG Pipelines
 Platform Teams                          Document Processing
                                         Content Generation
                                         Workflow Automation (n8n, Zapier)
                │                                    │
                └──────────┐          ┌──────────────┘
                           ▼          ▼
                  ┌─────────────────────────┐
                  │      Your Codebase       │
                  │                          │
                  │  client.messages.create(  │
                  │    model: "claude-opus-4" │
                  │  )                        │
                  └────────────┬─────────────┘
                               │
                               ▼
              ┌─────────────────────────────────┐
              │           Inferwise              │
              │                                  │
              │  npx inferwise estimate .         │
              │  npx inferwise diff               │
              │  npx inferwise price --compare    │
              └──────┬──────────┬───────────┬────┘
                     │          │           │
                     ▼          ▼           ▼
               CLI Output   PR Comment   JSON API
               (terminal)   (GitHub CI)  (agents &
                                          tooling)
                     │          │           │
                     ▼          ▼           ▼
              ┌─────────────────────────────────┐
              │          Decisions               │
              │                                  │
              │  ✓ Swap Opus → Sonnet (-$117/mo) │
              │  ✓ Block PR over $500 increase   │
              │  ✓ Agent picks cheapest model    │
              │  ✓ Team sets per-endpoint budget  │
              └─────────────────────────────────┘
```

### The Workflow

1. Developer (or AI agent) writes code with LLM API calls
2. `inferwise estimate` shows projected costs before committing
3. `inferwise diff` runs in CI on every pull request
4. GitHub Action posts a cost comment on the PR
5. Team reviews cost impact alongside the code diff
6. `--fail-on-increase` gates prevent budget blowouts from merging

### Concrete Example

An AI agent builds a RAG pipeline and picks Opus for every call — embeddings, retrieval, summarization, response generation.

Inferwise flags: **"+$2,400/mo in new LLM costs"** on the PR.

The developer asks the agent to use Sonnet where Opus isn't needed (embeddings, summarization). Cost drops to **$600/mo**.

**$1,800/mo saved before a single line ships.**

### What About Auto-Model Selection?

Tools like Cursor's "auto" model and custom model routers select models dynamically at runtime — the model choice isn't visible in your source code. Inferwise handles this differently depending on the pattern:

- **Hardcoded model strings** (`model: "claude-opus-4"`) — fully detected and priced.
- **Config-driven models** (`model: config.chatModel`) — detected as a call site, flagged as dynamic. You see where LLM calls happen even if the exact model isn't statically known.
- **Runtime routers** (Cursor auto, custom routers) — the routing decision happens outside your code. Inferwise can't see it, but this is where `inferwise price --compare` helps: you can pre-evaluate which models the router might select and understand the cost range.

Inferwise is most accurate for **explicit model selection in source code**, which is how the majority of production LLM integrations work today. For dynamic routing, it serves as a planning and comparison tool rather than an exact estimator.

### Accuracy and Limitations

Inferwise uses static analysis — it reads your source code, not your runtime traffic. Here's what that means:

| What It Does Well | Where Estimates Are Rough |
|-------------------|--------------------------|
| Detects every LLM API call site in your codebase | Dynamic prompts use worst-case model limits (`context_window − max_output_tokens`) |
| Exact pricing from bundled provider data (updated daily) | Unknown models fall back to cheapest current model for the provider |
| Static prompts tokenized for exact input cost | Volume is uniform across call sites (override per-path in config) |
| `max_tokens` extracted from code for exact output cost | Can't resolve model names from variables or config files |

Every call site always produces a real dollar value — no placeholders, no $0. Static prompts and `max_tokens` from code give exact costs. Dynamic prompts use worst-case ceilings from the model spec (marked with `*` in output). Unknown models fall back to the cheapest current model for the provider as a floor estimate. For exact runtime costs, pair Inferwise with provider dashboards or usage APIs.

---

## Commands

### `inferwise estimate [path]`

Scan a directory for LLM API calls and estimate token costs.

```bash
inferwise estimate .
inferwise estimate ./src --volume 5000
inferwise estimate . --format markdown
inferwise estimate . --format json
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--volume <n>` | `1000` | Requests/day for monthly cost projection |
| `--format <table\|json\|markdown>` | `table` | Output format |
| `--precise` | off | Use provider APIs for exact token counts (requires API keys) |
| `--config <path>` | auto | Path to `inferwise.config.json` |

**Example output:**

```
File               Line  Provider   Model                   Input  Output  Cost/Call  Monthly
src/chat.ts        42    anthropic  claude-sonnet-4         1,200  600     $0.0126    $378/mo
src/summarize.ts   18    openai     gpt-4o                  800    400     $0.0064    $192/mo
```

---

### `inferwise diff [base] [head]`

Compare token costs between two git refs.

```bash
inferwise diff
inferwise diff --base main --head HEAD
inferwise diff --volume 5000 --fail-on-increase 500
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--base <ref>` | `main` | Base git ref |
| `--head <ref>` | `HEAD` | Head git ref |
| `--volume <n>` | `1000` | Requests/day |
| `--format <table\|json\|markdown>` | `table` | Output format |
| `--fail-on-increase <amount>` | off | Exit 1 if monthly increase exceeds `$amount` |

---

### `inferwise audit [path]`

Find cost optimization opportunities: cheaper model alternatives, cacheable responses, batchable calls.

```bash
inferwise audit .
inferwise audit ./src --format markdown
```

---

### `inferwise price [provider] [model]`

Look up model pricing instantly. Designed for both humans and AI agents to make cost-aware model decisions.

```bash
# Look up a model's pricing
inferwise price anthropic claude-sonnet-4

# Calculate cost for specific token counts
inferwise price anthropic claude-sonnet-4 --input-tokens 2000 --output-tokens 1000

# Compare models side by side
inferwise price --compare anthropic/claude-sonnet-4 openai/gpt-4o

# List all models for a provider
inferwise price --list anthropic

# List all models
inferwise price --list-all
```

**Flags:**

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

## GitHub Action

Add automatic cost diff comments to every pull request.

Create `.github/workflows/inferwise.yml`:

```yaml
name: Inferwise Cost Diff

on:
  pull_request:

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
          volume: 1000
```

**Action inputs:**

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | required | GitHub token for PR comments |
| `base-ref` | `main` | Base branch to compare against |
| `volume` | `1000` | Requests/day for cost projection |
| `fail-on-increase` | — | Fail if monthly cost increases by more than `$N` |
| `working-directory` | `.` | Directory to scan |

**Example PR comment:**

```
## Inferwise Cost Report

| File            | Model                          | Change    | Cost/Call | Monthly Impact |
|-----------------|--------------------------------|-----------|-----------|----------------|
| src/chat.ts     | claude-opus-4 → claude-sonnet-4 | Downgrade | -$0.045   | -$13,500/mo   |
| src/summarize.ts| (new) gpt-4o                   | Added     | +$0.008   | +$2,400/mo    |

**Net monthly impact: -$11,100/mo**
```

---

## Programmatic and Agent Integration

Inferwise isn't just a CLI — `inferwise price` and `@inferwise/pricing-db` are designed to be called by any system that needs cost-aware model selection: AI agents, workflow automation, custom model routers, or your own tooling.

**CLI (for tool-use agents and scripts):**

```bash
# AI agent queries cost before choosing a model
inferwise price openai gpt-4o --input-tokens 2000 --output-tokens 1000 --format json

# Compare options in a CI script or automation pipeline
inferwise price --compare anthropic/claude-sonnet-4 openai/gpt-4o --format json
```

**SDK (for applications, routers, and pipelines):**

```typescript
import { getModel, calculateCost, getAllModels } from "@inferwise/pricing-db";

// Pre-flight cost check in a workflow automation
const model = getModel("anthropic", "claude-sonnet-4-20250514");
const cost = calculateCost({ model, inputTokens: 2000, outputTokens: 1000 });

// Build a cost-aware model router
const budget = 0.01; // max $/call
const candidates = getAllModels()
  .filter(m => m.tier === "mid" && m.supports_tools)
  .sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
```

**Use cases:**

- **AI coding agents** — query cost before selecting a model in generated code
- **Workflow automation** — n8n, Zapier, or custom pipelines that call LLM APIs at volume
- **Custom model routers** — select the cheapest model that meets task requirements
- **Budget enforcement** — reject requests that exceed a per-call or per-month threshold
- **Cost dashboards** — feed pricing data into internal reporting tools

---

## Supported Frameworks

| Framework | Detected Patterns | Notes |
|-----------|-------------------|-------|
| Anthropic SDK | `.messages.create()` | TS/JS and Python |
| OpenAI SDK | `.chat.completions.create()` | TS/JS and Python |
| Google GenAI SDK | `.generateContent()`, `GenerativeModel()` | |
| xAI SDK | `.chat.completions.create()` | OpenAI-compatible; provider resolved from model ID (`grok-*`) |
| LangChain | `ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI`, `ChatXAI` | |
| Vercel AI SDK | `generateText`, `streamText`, `generateObject`, `streamObject` | Provider inferred from model factory |

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

---

## Configuration

Create `inferwise.config.json` in your project root:

```json
{
  "defaultVolume": 1000,
  "ignore": ["node_modules", "test", "__tests__", "*.test.ts", "*.spec.ts"],
  "overrides": [
    {
      "pattern": "src/chat/**",
      "volume": 5000
    }
  ]
}
```

---

## Pricing Database

The [`@inferwise/pricing-db`](packages/pricing-db) package ships bundled pricing for all supported providers and is updated daily via automated sync.

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

## Project Structure

```
inferwise/
├── packages/
│   ├── cli/              # inferwise CLI (Commander.js + tsup)
│   ├── pricing-db/       # @inferwise/pricing-db — bundled pricing JSON
│   └── github-action/    # Standalone GitHub Action
├── scripts/              # Maintenance scripts (pricing sync)
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
pnpm test
pnpm lint
pnpm typecheck
```

**Workspace commands:**

```bash
pnpm --filter @inferwise/cli build       # Build CLI only
pnpm --filter @inferwise/pricing-db test # Test pricing-db only
pnpm --filter @inferwise/scripts sync-pricing  # Sync provider pricing
```

---

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

**Quick start:** fork, branch, make changes, run `pnpm lint && pnpm build && pnpm typecheck && pnpm test`, open a PR.

**Pricing data corrections** are especially valuable — edit the JSON files in [`packages/pricing-db/providers/`](packages/pricing-db/providers/) and open a PR with evidence from the official pricing page. CI validates against [`schema.json`](packages/pricing-db/schema.json) automatically.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

## About

Inferwise is the FinOps layer for LLM inference. We help developers and teams see, control, and optimize what they spend on AI — before it hits production.

[inferwise.dev](https://inferwise.dev) · [GitHub](https://github.com/inferwise/inferwise) · [npm](https://www.npmjs.com/package/inferwise)
