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

Contributions are welcome. Please:

1. Fork the repo and create a feature branch
2. Follow the existing code style (TypeScript strict, Biome for lint/format)
3. Write tests for any new public functions (Vitest)
4. Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`
5. Open a PR — the Inferwise Action will post a cost diff automatically

### Updating Pricing Data

The pricing database lives in [`packages/pricing-db/providers/`](packages/pricing-db/providers/) as human-readable JSON files. Community corrections and additions are encouraged:

1. Edit the relevant provider JSON file (e.g., `anthropic.json`, `openai.json`)
2. All files must conform to [`schema.json`](packages/pricing-db/schema.json) — CI validates this automatically
3. Update `last_verified` to today's date and include the official pricing page URL in `source`
4. Run `pnpm test` to verify schema validation passes
5. Open a PR with the pricing page link as evidence

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

Built with care by the Inferwise team. Visit [inferwise.dev](https://inferwise.dev) for the full platform.
