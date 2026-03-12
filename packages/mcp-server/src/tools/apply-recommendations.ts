import type { Provider } from "@inferwise/pricing-db";
import {
  getAllProviders,
  inferRequiredCapabilities,
  suggestAlternatives,
} from "@inferwise/pricing-db";
import type { ApplyResult, ModelSwap } from "inferwise/fix-core";
import { applyRecommendations } from "inferwise/fix-core";
import { estimate } from "inferwise/sdk";

export interface ApplyRecommendationsInput {
  directory: string;
  volume?: number | undefined;
  dryRun?: boolean | undefined;
  recommendations?:
    | Array<{
        file: string;
        line: number;
        currentModel: string;
        suggestedModel: string;
      }>
    | undefined;
}

/** Build recommendations from audit if not provided. */
async function buildSwapsFromAudit(directory: string, volume: number): Promise<ModelSwap[]> {
  const result = await estimate(directory, { volume });
  const validProviders = new Set<string>(getAllProviders());
  const swaps: ModelSwap[] = [];

  for (const row of result.rows) {
    if (!validProviders.has(row.provider)) continue;
    const provider = row.provider as Provider;
    const promptText = [row.systemPrompt, row.userPrompt].filter(Boolean).join(" ");
    const capabilities = inferRequiredCapabilities(promptText || row.model);
    const alts = suggestAlternatives(row.model, provider, capabilities);
    const best = alts[0];
    if (!best || best.savingsPercent < 20) continue;

    swaps.push({
      file: row.file,
      line: row.line,
      currentModel: row.model,
      suggestedModel: best.model.id,
      monthlySavings: row.monthlyCost * (best.savingsPercent / 100),
    });
  }

  return swaps;
}

/** Handle the apply_recommendations tool call. */
export async function handleApplyRecommendations(
  input: ApplyRecommendationsInput,
): Promise<ApplyResult> {
  const volume = input.volume ?? 1000;
  const dryRun = input.dryRun ?? false;

  let swaps: ModelSwap[];

  if (input.recommendations && input.recommendations.length > 0) {
    swaps = input.recommendations.map((r) => ({
      file: r.file,
      line: r.line,
      currentModel: r.currentModel,
      suggestedModel: r.suggestedModel,
    }));
  } else {
    swaps = await buildSwapsFromAudit(input.directory, volume);
  }

  return applyRecommendations(swaps, input.directory, dryRun);
}
