# Inferwise

**Know your LLM costs before you commit.**

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

### AI Agents Don't Think About Cost

When AI coding agents (Cursor, Claude Code, Copilot, Devin) generate code, they optimize for correctness — not cost. They'll reach for `claude-opus-4` on every call because it's the most capable model. Without a cost gate in your workflow, expensive model choices ship silently into production.

### The Real Workflow

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

## AI Agent Integration

The `inferwise price` command and `@inferwise/pricing-db` package are designed to be called by AI agents mid-generation — so they can make cost-aware model decisions in real-time rather than discovering costs after code ships.

**CLI (for tool-use agents):**

```bash
inferwise price openai gpt-4o --input-tokens 2000 --output-tokens 1000 --format json
```

**SDK (for programmatic use):**

```typescript
import { getModel, calculateCost } from "@inferwise/pricing-db";

const model = getModel("anthropic", "claude-sonnet-4-20250514");
const cost = calculateCost({ model, inputTokens: 2000, outputTokens: 1000 });
// Agent can now decide: is this model worth the cost for this task?
```

An AI agent can query Inferwise before choosing a model — checking cost per call, comparing alternatives, and selecting the most cost-effective option that meets the task requirements. The JSON output format is optimized for machine consumption.

---

## Supported Frameworks

| Framework | Detected Patterns |
|-----------|-------------------|
| Anthropic SDK | `client.messages.create`, `anthropic.messages.create` |
| OpenAI SDK | `client.chat.completions.create`, `openai.chat.completions.create` |
| Google AI SDK | `generativeai.GenerativeModel`, `genai.GenerativeModel` |
| xAI SDK | `xai.chat.completions.create` |
| LangChain | `ChatAnthropic`, `ChatOpenAI`, `ChatGoogleGenerativeAI` |
| Vercel AI SDK | `generateText`, `streamText`, `generateObject` |

**Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

---

## Configuration

Create `inferwise.config.json` in your project root:

```json
{
  "defaultVolume": 1000,
  "outputTokenEstimation": {
    "method": "multiplier",
    "multiplier": 2.0
  },
  "ignore": ["node_modules", "test", "__tests__", "*.test.ts", "*.spec.ts"],
  "overrides": [
    {
      "pattern": "src/chat/**",
      "volume": 5000,
      "outputTokenMultiplier": 3.0
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
│   ├── github-action/    # Standalone GitHub Action
│   └── sdk/              # @inferwise/sdk — programmatic API
├── apps/
│   ├── dashboard/        # SaaS dashboard (React + Vite)
│   ├── api/              # Backend API (Hono on Cloudflare Workers)
│   └── proxy/            # Model router proxy (Cloudflare Workers)
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

Built with care by the Inferwise team. Visit [inferwise.dev](https://inferwise.dev) for the full platform.
