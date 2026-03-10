# Inferwise — Product Specification

## Overview

Inferwise is a FinOps platform purpose-built for LLM inference costs.

**Website:** inferwise.dev
**GitHub:** github.com/inferwise
**npm:** inferwise

## What This Repo Contains

1. **CLI** (`inferwise`) — Pre-commit token cost estimation
2. **Pricing Database** (`@inferwise/pricing-db`) — Bundled provider pricing, updated daily
3. **GitHub Action** (`inferwise/inferwise-action`) — PR cost diff comments in CI

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
│   │       ├── commands/       # estimate, diff, audit, price, update-pricing
│   │       ├── scanners/       # Regex-based LLM API call detection
│   │       ├── tokenizers/     # Provider tokenizer wrappers
│   │       ├── formatters/     # table, markdown, JSON output
│   │       └── index.ts        # CLI entry point
│   ├── pricing-db/             # @inferwise/pricing-db
│   │   ├── providers/
│   │   │   ├── anthropic.json
│   │   │   ├── openai.json
│   │   │   ├── google.json
│   │   │   └── xai.json
│   │   ├── schema.json
│   │   └── src/index.ts
│   └── github-action/
│       ├── action.yml
│       └── src/index.ts
├── scripts/                    # Maintenance scripts (pricing sync)
├── .github/workflows/          # CI, cost-diff, pricing sync, publish
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── biome.json
```

---

## CLI Commands

### `inferwise estimate [path]`

Scan a directory for LLM API calls and estimate costs.

**Output columns:** File, Line, Provider, Model, Input Tokens (est), Output Tokens (est), Cost/Call, Monthly Cost

**Flags:**
- `--volume <n>` — Requests/day for monthly projection (default: 1000)
- `--format <table|json|markdown>` — Output format (default: table)
- `--precise` — Use provider APIs for exact token counts (requires API keys)
- `--config <path>` — Path to inferwise.config.json

### `inferwise diff [base] [head]`

Compare token costs between two git refs.

**Output:** Side-by-side diff showing old vs new cost per call site with net monthly impact.

**Flags:**
- `--base <ref>` — Base git ref (default: main)
- `--head <ref>` — Head git ref (default: HEAD)
- `--volume <n>` — Requests/day
- `--format <table|json|markdown>`
- `--fail-on-increase <amount>` — Exit 1 if monthly increase exceeds threshold

### `inferwise audit [path]`

Scan for cost optimization: cheaper model opportunities, cacheable responses, batchable calls.

---

## Configuration File

`inferwise.config.json` in project root:

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

All token counts are derived from code extraction or model spec data — no hardcoded defaults or multipliers.

**Input tokens (priority order):**
1. Static prompt found in code → tokenized for exact count (source: `code`)
2. Dynamic prompt → `context_window - max_output_tokens` from model spec (source: `model_limit`)
3. Unknown model → cheapest current model for the provider used as floor

**Output tokens (priority order):**
1. `max_tokens` / `maxTokens` / `max_output_tokens` extracted from code → exact (source: `code`)
2. No max_tokens in code → `max_output_tokens` from model spec (source: `model_limit`)
3. Unknown model → cheapest current model for the provider used as floor

**Tokenizer implementations:**

| Provider | Tokenizer | Notes |
|----------|-----------|-------|
| OpenAI (GPT-4o, o3, o4-mini, etc.) | `tiktoken` with native model encoding | Exact — OpenAI publishes their tokenizer |
| Anthropic (Claude Opus, Sonnet, Haiku) | `cl100k_base` approximation | ±5% — Anthropic does not publish a tokenizer |
| Google (Gemini 2.5 Pro, Flash, etc.) | `cl100k_base` approximation | Google does not publish a tokenizer |
| xAI (Grok 3, Grok 3 Mini, etc.) | `cl100k_base` approximation | xAI does not publish a tokenizer |

- **Unified interface:** `countTokens(provider, model, text): number`
- Non-OpenAI providers all use the same `cl100k_base` encoding from `tiktoken` as a best-available approximation. No unvalidated correction factors are applied.

**TokenSource tracking:** Every estimate is tagged as `"code"` (exact) or `"model_limit"` (worst-case ceiling). Model-limit values display with `*` in output so users know which costs are ceilings vs exact.

---

## Code Scanner Strategy

Regex-based pattern matching (not AST parsing) for speed.

**Detected patterns:**

| Provider | SDK / Framework | Patterns | Notes |
|----------|----------------|----------|-------|
| Anthropic | Anthropic SDK (TS/JS/Python) | `.messages.create()` | |
| OpenAI | OpenAI SDK (TS/JS/Python) | `.chat.completions.create()` | |
| Google | Google GenAI SDK | `.generateContent()`, `genai.GenerativeModel()`, `GenerativeModel()` | |
| xAI | OpenAI-compatible SDK | `.chat.completions.create()` | Same pattern as OpenAI; provider resolved from model ID (e.g., `grok-3` → xAI) |
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
ANTHROPIC_API_KEY=       # Precise token counting
OPENAI_API_KEY=          # Precise token counting
GOOGLE_API_KEY=          # Precise token counting
INFERWISE_CONFIG=        # Config file path override
INFERWISE_VOLUME=        # Default daily request volume
```

---

## Current Status

Phase 1 is complete and published:

1. Pricing database package with all provider JSON files
2. Tokenizer wrappers (unified `countTokens` interface)
3. Code scanner (regex pattern matching)
4. `inferwise estimate` command
5. `inferwise diff` command
6. `inferwise audit` command
7. `inferwise price` command
8. GitHub Action (PR cost diff comments)
9. Comprehensive tests (55 passing)
10. Published to npm as `inferwise`

---

## Design Principles

- **Accuracy over speed.** A wrong estimate erodes trust. Show a range if unsure.
- **Zero config to start.** `npx inferwise estimate .` works without setup.
- **Progressive disclosure.** Simple output by default, detailed with flags.
- **Offline-first CLI.** Pricing database is bundled. No API calls for basic estimation.
- **Multi-provider always.** Never optimize for one provider.

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
