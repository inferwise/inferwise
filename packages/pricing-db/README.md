# @inferwise/pricing-db

Maintained pricing database for LLM providers. Ships bundled JSON pricing for Anthropic, OpenAI, Google, and xAI models.

## Install

```bash
npm install @inferwise/pricing-db
```

## Usage

```typescript
import { getModel, calculateCost, getAllProviders } from "@inferwise/pricing-db";

const model = getModel("anthropic", "claude-sonnet-4-20250514");
const cost = calculateCost({ model, inputTokens: 1000, outputTokens: 500 });
console.log(`Cost: $${cost.toFixed(6)}`);
```

## API

- `getAllProviders()` — List all supported providers
- `getAllModels()` — Get all models across all providers
- `getModel(provider, modelId)` — Look up a model by ID or alias
- `getProviderModels(provider)` — Get all models for a provider
- `calculateCost(params)` — Calculate USD cost for a request
- `getProviderMeta(provider)` — Get metadata (dates, source URL)
- `getPricingAgeInDays(provider)` — Days since last verification

## Pricing Data

JSON files in `providers/` are validated against `schema.json` in CI. Community contributions welcome — see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache 2.0
