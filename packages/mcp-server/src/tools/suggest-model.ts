import type { Provider } from "@inferwise/pricing-db";
import {
  type AlternativeSuggestion,
  type TaskSuggestion,
  getAllProviders,
  suggestAlternatives,
  suggestModelForTask,
} from "@inferwise/pricing-db";

export interface SuggestModelInput {
  task: string;
  provider?: string | undefined;
  maxCostPerMillionTokens?: number | undefined;
}

interface SuggestModelResult {
  recommended: {
    provider: string;
    model: string;
    name: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
    capabilities: string[];
  };
  alternatives: Array<{
    provider: string;
    model: string;
    name: string;
    outputCostPerMillion: number;
    savingsPercent: number;
  }>;
  inferredCapabilities: string[];
  reasoning: string;
}

function isValidProvider(value: string): value is Provider {
  return (getAllProviders() as string[]).includes(value);
}

/** Handle the suggest_model tool call. */
export function handleSuggestModel(input: SuggestModelInput): SuggestModelResult | string {
  const providerOpt =
    input.provider && isValidProvider(input.provider) ? input.provider : undefined;

  const suggestion = suggestModelForTask(input.task, {
    ...(providerOpt ? { provider: providerOpt } : {}),
    ...(input.maxCostPerMillionTokens ? { maxCostPerMillion: input.maxCostPerMillionTokens } : {}),
  });

  if (!suggestion) {
    return "No model found matching the inferred capabilities for this task.";
  }

  const alts = suggestAlternatives(
    suggestion.model.id,
    suggestion.model.provider,
    suggestion.inferredCapabilities,
  );

  return formatResult(suggestion, alts);
}

function formatResult(
  suggestion: TaskSuggestion,
  alts: AlternativeSuggestion[],
): SuggestModelResult {
  return {
    recommended: {
      provider: suggestion.model.provider,
      model: suggestion.model.id,
      name: suggestion.model.name,
      inputCostPerMillion: suggestion.model.input_cost_per_million,
      outputCostPerMillion: suggestion.model.output_cost_per_million,
      capabilities: [...suggestion.model.capabilities],
    },
    alternatives: alts.map((a) => ({
      provider: a.model.provider,
      model: a.model.id,
      name: a.model.name,
      outputCostPerMillion: a.model.output_cost_per_million,
      savingsPercent: a.savingsPercent,
    })),
    inferredCapabilities: [...suggestion.inferredCapabilities],
    reasoning: suggestion.reasoning,
  };
}
