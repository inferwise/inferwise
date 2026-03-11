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

### Pricing Queries

- `getAllProviders()` — List all supported providers
- `getAllModels()` — Get all models across all providers
- `getModel(provider, modelId)` — Look up a model by ID or alias
- `getProviderModels(provider)` — Get all models for a provider
- `calculateCost(params)` — Calculate USD cost for a request
- `getProviderMeta(provider)` — Get metadata (dates, source URL)
- `getPricingAgeInDays(provider)` — Days since last verification

### Capability-Based Model Selection

- `inferRequiredCapabilities(text)` — Infer required capabilities from a task description or prompt text. Returns capabilities like `"code"`, `"reasoning"`, `"general"`, `"creative"`, `"vision"`, `"search"`, `"audio"`.
- `getModelsByCapabilities(required, options?)` — Find models matching required capabilities, sorted by cost (cheapest first). Filter by provider, status, or max cost.
- `suggestAlternatives(modelId, provider, capabilities)` — Find cheaper models that match the same capabilities. Returns alternatives with savings percentage and reasoning.
- `suggestModelForTask(text, options?)` — End-to-end: infer capabilities from a task description, find the cheapest capable model, and return it with reasoning.

```typescript
import { suggestModelForTask, suggestAlternatives, inferRequiredCapabilities } from "@inferwise/pricing-db";

// Suggest the cheapest model for a task
const suggestion = suggestModelForTask("classify support tickets by category");
// → { model: gpt-4o-mini, inferredCapabilities: ["general"], reasoning: "..." }

// Find cheaper alternatives to an expensive model
const alts = suggestAlternatives("claude-opus-4-20250514", "anthropic", ["code"]);
// → [{ model: claude-sonnet-4, savingsPercent: 80, reasoning: "..." }]
```

## Pricing Data

JSON files in `providers/` are validated against `schema.json` in CI. Community contributions welcome — see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache 2.0
