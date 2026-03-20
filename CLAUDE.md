# Inferwise

FinOps CLI for LLM inference costs — scan, estimate, and diff token costs before they ship.

Full product spec is in SPEC.md (loaded via the `inferwise-spec` skill when needed).

## Commands

```bash
pnpm install              # Install all workspace deps
pnpm build                # Build all packages (tsup)
pnpm test                 # Run all tests (Vitest)
pnpm lint                 # Lint + format (Biome)
pnpm typecheck            # Type-check all packages
pnpm sync-pricing         # Sync model pricing from LiteLLM
pnpm sync-benchmarks      # Sync quality scores from Chatbot Arena (requires Python + pandas)
```

## Pricing Sync & Data Integrity

- **Daily sync** (`pnpm sync-pricing`): pulls from LiteLLM, applies `MANUAL_OVERRIDES` for known-wrong values, then writes provider JSON.
- **Weekly sync** (`pnpm sync-benchmarks`): pulls quality scores from Chatbot Arena.
- **Both GitHub Actions and GitLab CI** run these on schedule. Both run `biome format --write` on synced files before committing.
- **`MANUAL_OVERRIDES`** in `scripts/sync-pricing.ts`: LiteLLM sometimes has wrong metadata (e.g., Bedrock context windows vs 1P API). Overrides force correct values after merge.
- **Pricing invariant tests** in `packages/pricing-db/src/index.test.ts`: hard assertions on costs, context windows, and output limits for critical models. Update these when providers change pricing.
- When adding/updating models: update `SYNC_CONFIG` in `scripts/sync-pricing.ts`, the provider JSON, `MANUAL_OVERRIDES` if needed, and the invariant test table.

## Project-Specific Rules

- Result types for recoverable errors. Throw only for unrecoverable errors.
- Tests required for every public function.
- CLI commands: lowercase single words (`estimate`, `diff`, `audit`)
- No Ink or Oclif — use Commander.js for CLI
