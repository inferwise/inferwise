# Contributing to Inferwise

Thanks for your interest in contributing to Inferwise. This guide covers everything you need to get started.

## Getting Started

**Requirements:** Node.js 18+, pnpm 9+

```bash
git clone https://github.com/inferwise/inferwise.git
cd inferwise
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
inferwise/
├── packages/
│   ├── cli/              # inferwise CLI (Commander.js + tsup)
│   ├── pricing-db/       # @inferwise/pricing-db — bundled pricing JSON
│   ├── github-action/    # Standalone GitHub Action
│   └── sdk/              # @inferwise/sdk — programmatic API
├── scripts/              # Maintenance scripts (pricing sync)
└── .github/workflows/    # CI, cost-diff, pricing sync, publish
```

## Development Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run the checks locally before pushing:

```bash
pnpm lint        # Lint + format (Biome, auto-fixes)
pnpm build       # Build all packages
pnpm typecheck   # Type-check all packages
pnpm test        # Run all tests
```

4. Push your branch and open a PR against `main`

CI runs all four checks above across Ubuntu, macOS, and Windows. Your PR must pass all three platforms.

## Code Style

- **TypeScript strict mode** everywhere. No `any` — use `unknown` with type guards.
- **Named exports only** (except CLI entry points).
- **async/await only.** No `.then()` chains.
- **Max 40 lines per function.** Break up anything longer.
- **Biome** for linting and formatting. Run `pnpm lint` to auto-fix.

### Naming Conventions

| What | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `token-counter.ts` |
| Types/Interfaces | PascalCase | `ModelPricing` |
| Functions/Variables | camelCase | `calculateCost` |
| Constants | UPPER_SNAKE_CASE | `MAX_TOKENS` |
| CLI commands | lowercase | `estimate`, `diff` |

### What NOT to use

| Avoid | Use Instead |
|-------|-------------|
| Jest | Vitest |
| Prettier / ESLint | Biome |
| Webpack | tsup |
| Ink / Oclif | Commander.js |
| yarn / npm | pnpm |

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add support for Mistral provider
fix: correct token count for cached prompts
docs: update CLI usage examples
chore: bump dependencies
test: add edge case tests for cost calculator
refactor: simplify scanner regex patterns
```

## What to Contribute

### Pricing Data

The pricing database is community-maintained. This is one of the highest-impact contributions you can make.

**Files:** `packages/pricing-db/providers/{anthropic,openai,google,xai}.json`

1. Edit the relevant provider JSON file
2. All files must conform to [`schema.json`](packages/pricing-db/schema.json) — CI validates automatically
3. Update `last_verified` to today's date
4. Keep the official pricing page URL in `source`
5. Run `pnpm test` to verify schema validation passes
6. Open a PR with a link to the official pricing page as evidence

### New Provider Support

To add a new LLM provider:

1. Create `packages/pricing-db/providers/{provider}.json` following the schema
2. Add the provider to the `Provider` type in `packages/pricing-db/src/index.ts`
3. Add scanner patterns in `packages/cli/src/scanners/index.ts`
4. Add tokenizer support in `packages/cli/src/tokenizers/index.ts`
5. Add tests for each new file
6. Update the schema `provider` enum in `packages/pricing-db/schema.json`

### Scanner Patterns

The CLI detects LLM API calls via regex patterns. To improve detection:

- Patterns live in `packages/cli/src/scanners/index.ts`
- Each pattern extracts: file path, line number, provider, model name
- Add test cases in `packages/cli/src/scanners/index.test.ts`
- Supported file types: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`

### Bug Reports

Open an issue with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Output of `inferwise --version` and `node --version`

### Feature Requests

Open an issue describing:

1. The problem you're trying to solve
2. Your proposed solution
3. Any alternatives you considered

## Workspace Commands

```bash
pnpm --filter @inferwise/cli build           # Build CLI only
pnpm --filter @inferwise/pricing-db test     # Test pricing-db only
pnpm --filter @inferwise/scripts sync-pricing # Sync provider pricing
pnpm -r typecheck                             # Typecheck all packages
```

## Architecture Decisions

- **Offline-first:** The CLI bundles all pricing data. No API calls for basic estimation.
- **Regex over AST:** Scanner uses regex for speed. Accuracy is good enough for estimation; AST parsing may come later.
- **Per-million pricing:** All costs stored as USD per million tokens for consistency across providers.
- **Schema-validated:** Every provider JSON is validated against `schema.json` in CI. No malformed data ships.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
