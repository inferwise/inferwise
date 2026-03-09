# Inferwise

FinOps CLI for LLM inference costs — scan, estimate, and diff token costs before they ship.

See @SPEC.md for full product spec, CLI commands, and architecture.

## Commands

```bash
pnpm install          # Install all workspace deps
pnpm build            # Build all packages (tsup)
pnpm test             # Run all tests (Vitest)
pnpm lint             # Lint + format (Biome)
pnpm typecheck        # Type-check all packages
```

## Package Manager

IMPORTANT: Use `pnpm` only. Never npm or yarn. Never use `npm install` or `yarn add`.

## Coding Rules

- TypeScript strict mode everywhere. No `any` — use `unknown` with type guards.
- Named exports only (except CLI entry points which use default export).
- async/await only. Never `.then()` chains.
- Result types for recoverable errors. Throw only for unrecoverable errors.
- Max 40 lines per function. Break up anything longer.
- Tests required for every public function. Use Vitest.

## Naming

- Files: `kebab-case.ts`
- Types/Interfaces: `PascalCase`
- Functions/Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- CLI commands: lowercase single words (`estimate`, `diff`, `audit`)

## IMPORTANT: Do Not Use

- No Jest → use Vitest
- No Prettier or ESLint → use Biome
- No Webpack → use tsup
- No Ink or Oclif → use Commander.js
- No yarn or npm → use pnpm

## Commit Style

Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`
