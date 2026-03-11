import type { Provider } from "@inferwise/pricing-db";
import { calculateCost, getAllProviders, getModel } from "@inferwise/pricing-db";

const DAYS_PER_MONTH = 30;

export interface EstimateCostInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requestsPerDay?: number | undefined;
  useBatch?: boolean | undefined;
  useCache?: boolean | undefined;
}

interface EstimateCostResult {
  provider: string;
  model: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  costPerCall: number;
  monthlyCost: number | null;
  requestsPerDay: number | null;
  pricing: {
    inputCostPerMillion: number;
    outputCostPerMillion: number;
  };
}

function isValidProvider(value: string): value is Provider {
  return (getAllProviders() as string[]).includes(value);
}

/** Handle the estimate_cost tool call. */
export function handleEstimateCost(input: EstimateCostInput): EstimateCostResult | string {
  if (!isValidProvider(input.provider)) {
    return `Unknown provider "${input.provider}". Valid: ${getAllProviders().join(", ")}`;
  }

  const model = getModel(input.provider, input.model);
  if (!model) {
    return `Unknown model "${input.model}" for provider "${input.provider}".`;
  }

  const costPerCall = calculateCost({
    model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    ...(input.useBatch ? { useBatch: true } : {}),
    ...(input.useCache ? { cachedInputTokens: input.inputTokens } : {}),
  });

  const monthlyCost = input.requestsPerDay
    ? costPerCall * input.requestsPerDay * DAYS_PER_MONTH
    : null;

  return {
    provider: input.provider,
    model: model.id,
    modelName: model.name,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costPerCall,
    monthlyCost,
    requestsPerDay: input.requestsPerDay ?? null,
    pricing: {
      inputCostPerMillion: model.input_cost_per_million,
      outputCostPerMillion: model.output_cost_per_million,
    },
  };
}
