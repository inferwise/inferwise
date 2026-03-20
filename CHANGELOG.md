# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-03-20

### Fixed
- GitLab and GitHub sync pipelines now run `biome format --write` on synced JSON before committing, preventing lint failures on the next CI run
- Corrected `claude-sonnet-4-6` context window from 200k to 1M (LiteLLM had Bedrock value, not 1P API)
- Removed incorrect above-200k premium pricing fields from `claude-sonnet-4-6` (Sonnet 4.6 includes full 1M at standard pricing)

### Added
- `MANUAL_OVERRIDES` in `scripts/sync-pricing.ts` — force-sets known-correct values that LiteLLM gets wrong (Bedrock vs 1P API context windows)
- Pricing invariant test suite (14 assertions) — validates critical models' costs, context windows, and output limits against official provider pages in CI

## [1.0.0] - 2026-03-12

First stable release. Production-ready.

### What's included
- CLI: `init`, `estimate`, `diff`, `audit`, `fix`, `check`, `calibrate`, `price`, `update-pricing`
- MCP Server: `suggest_model`, `estimate_cost`, `audit`, `apply_recommendations`
- SDK: `estimate()`, `estimateAndCheck()` for programmatic integration
- Pricing DB: 35+ models across Anthropic, OpenAI, Google, xAI, Perplexity — updated daily
- GitHub Action: PR cost comments, labels, reviewer requests, merge blocking
- OpenTelemetry integration: Grafana Tempo, Prometheus/OTLP backends
- OpenRouter calibration: all providers in one API call
- Budget enforcement: warn, block, requireApproval thresholds
- 381 tests passing on Ubuntu, macOS, Windows

## [0.3.0] - 2026-03-12

### Added
- **`inferwise fix`** command — auto-apply model swap recommendations to source files. Rewrites model IDs in-place, skips dynamic models, supports `--dry-run`, `--provider`, `--min-savings` filters.
- **`apply_recommendations` MCP tool** — AI agents can auto-fix expensive models programmatically. Accepts explicit swaps or runs audit internally.
- **OpenTelemetry integration** — fetch production token usage from Grafana Tempo or Prometheus/OTLP backends. New `telemetry` config field.
- **OpenRouter calibration provider** — calibrate all 5 providers in one command via `OPENROUTER_API_KEY`.
- 27 e2e integration tests, 13 fix-core tests (380 total)

### Changed
- Replaced `stats-client.ts` with `telemetry-client.ts` supporting three backends
- CI workflows bumped to Node 22 (Node 20 deprecated on GitHub Actions)
- Sync workflows now auto-commit `last_verified` directly to main (no stale PRs)
- Biome config: suppressed `noDefaultExport` for tsup/vitest config files

### Fixed
- CI lint failures caused by biome formatting drift and `noDefaultExport` warnings
- Branch protection required checks mismatched after Node version bump
- Pricing `last_verified` dates going stale (sync PRs never merged)

## [0.2.1] - 2026-03-11

### Added
- **MCP Server** (`@inferwise/mcp`) — AI agent integration via Model Context Protocol. Gives Claude Code, Cursor, VS Code, Windsurf, and other MCP-compatible tools three tools: `suggest_model`, `estimate_cost`, and `audit`.
- **Smart model recommendations** — `inferwise audit` now infers required capabilities (code, reasoning, creative, vision, etc.) from prompts in your code and suggests cheaper models that can handle the task, with reasoning and confidence levels.
- Capability-based model selection in `@inferwise/pricing-db`: `inferRequiredCapabilities()`, `getModelsByCapabilities()`, `suggestAlternatives()`, `suggestModelForTask()`

## [0.2.0] - 2026-03-10

### Added
- `inferwise check` command for AI agents and automation pipelines — validates absolute cost against budget thresholds
- SDK entry point (`inferwise/sdk`) with `estimate()` and `estimateAndCheck()` for programmatic integration
- `inferwise calibrate` command — fetches real usage data from Anthropic and OpenAI APIs to improve estimate accuracy
- Budget enforcement system with `warn`, `block`, and `requireApproval` thresholds
- GitHub Action (`inferwise/inferwise-action@v1`) — PR cost comments, labels, reviewer requests, merge blocking
- AWS Bedrock, Azure OpenAI, LiteLLM, and Perplexity scanner support
- LangChain (ChatBedrock, AzureChatOpenAI) and Vercel AI SDK detection
- Per-path volume overrides in `inferwise.config.json`
- Token source tracking (`code`, `typical`, `calibrated`, `model_limit`, `production`)

### Changed
- Default budget thresholds raised to production-safe levels (warn: $2,000, block: $50,000)

## [0.1.0] - 2026-03-10

### Added
- Initial release published to npm
- `inferwise estimate` — scan codebase for LLM API calls and estimate per-token costs
- `inferwise diff` — compare token costs between git refs with budget enforcement
- `inferwise audit` — find cheaper model alternatives, caching and batch opportunities
- `inferwise price` — look up model pricing for humans and AI agents
- `inferwise init` — project setup with config, git hooks, and CI instructions
- `inferwise update-pricing` — check pricing database freshness
- `@inferwise/pricing-db` — bundled pricing for 35+ models across Anthropic, OpenAI, Google, xAI
- Regex-based scanner supporting `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`
- Tokenizer wrappers using tiktoken (exact for OpenAI, approximate for others)
- Three output formats: table, JSON, markdown
