# Changelog

All notable changes to this project will be documented in this file.

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
