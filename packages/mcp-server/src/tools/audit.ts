import type { Provider } from "@inferwise/pricing-db";
import {
  getAllProviders,
  inferRequiredCapabilities,
  suggestAlternatives,
} from "@inferwise/pricing-db";
import { estimate } from "inferwise/sdk";

export interface AuditInput {
  directory: string;
  volume?: number | undefined;
}

interface SmartRecommendation {
  file: string;
  line: number;
  currentProvider: string;
  currentModel: string;
  currentCostPerCall: number;
  suggestedProvider: string;
  suggestedModel: string;
  reasoning: string;
  savingsPercent: number;
}

interface AuditResult {
  directory: string;
  volume: number;
  totalMonthlyCost: number;
  callSites: number;
  unknownModels: string[];
  recommendations: SmartRecommendation[];
}

/** Handle the audit tool call. */
export async function handleAudit(input: AuditInput): Promise<AuditResult> {
  const volume = input.volume ?? 1000;
  const result = await estimate(input.directory, { volume });

  const recommendations: SmartRecommendation[] = [];
  const validProviders = new Set<string>(getAllProviders());
  for (const row of result.rows) {
    if (!validProviders.has(row.provider)) continue;
    const provider = row.provider as Provider;
    const promptText = [row.systemPrompt, row.userPrompt].filter(Boolean).join(" ");
    const capabilities = inferRequiredCapabilities(promptText || row.model);
    const alts = suggestAlternatives(row.model, provider, capabilities);
    const best = alts[0];
    if (!best || best.savingsPercent < 20) continue;

    recommendations.push({
      file: row.file,
      line: row.line,
      currentProvider: row.provider,
      currentModel: row.model,
      currentCostPerCall: row.costPerCall,
      suggestedProvider: best.model.provider,
      suggestedModel: best.model.id,
      reasoning: best.reasoning,
      savingsPercent: best.savingsPercent,
    });
  }

  return {
    directory: input.directory,
    volume,
    totalMonthlyCost: result.totalMonthlyCost,
    callSites: result.rows.length,
    unknownModels: result.unknownModels,
    recommendations,
  };
}
