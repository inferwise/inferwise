/**
 * Core estimation logic shared between CLI commands and the SDK.
 * Extracted so `estimate`, `check`, and `estimateAndCheck()` all use the same math.
 */
import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import type { CalibrationData } from "./calibration.js";
import type { InferwiseConfig } from "./config.js";
import { resolveVolume } from "./config.js";
import type { EstimateRow, TokenSource } from "./formatters/index.js";
import type { ScanResult } from "./scanners/index.js";
import type { ModelStats } from "./stats-client.js";
import { countMessageTokens } from "./tokenizers/index.js";

/** When model is unknown, use the cheapest current model for the provider as a floor. */
function fallbackModel(provider: Provider): ModelPricing | undefined {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return undefined;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}

/**
 * Typical input token heuristic.
 * See HEURISTICS.md for full methodology and sources.
 */
function typicalInputTokens(pricing: ModelPricing): number {
  const TYPICAL_INPUT = 4096;
  if (pricing.context_window < 16_384) {
    return Math.min(TYPICAL_INPUT, Math.round(pricing.context_window * 0.25));
  }
  return TYPICAL_INPUT;
}

/**
 * Typical output token heuristic.
 * See HEURISTICS.md for full methodology and sources.
 */
function typicalOutputTokens(pricing: ModelPricing): number {
  const FLOOR = 512;
  const CEILING = 4096;
  return Math.max(FLOOR, Math.min(CEILING, Math.round(pricing.max_output_tokens * 0.05)));
}

function resolveInputTokens(
  result: ScanResult,
  pricing: ModelPricing | undefined,
  stats: ModelStats | undefined,
): { inputTokens: number; inputTokenSource: TokenSource } {
  if (result.systemPrompt || result.userPrompt) {
    const tokens = countMessageTokens(result.provider, result.model ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
    return { inputTokens: tokens, inputTokenSource: "code" };
  }

  if (stats && stats.request_count >= 10) {
    return {
      inputTokens: Math.round(stats.avg_input_tokens),
      inputTokenSource: "production",
    };
  }

  if (pricing) {
    return {
      inputTokens: typicalInputTokens(pricing),
      inputTokenSource: "typical",
    };
  }

  return { inputTokens: 0, inputTokenSource: "typical" };
}

function resolveOutputTokens(
  result: ScanResult,
  pricing: ModelPricing | undefined,
  stats: ModelStats | undefined,
): { outputTokens: number; outputTokenSource: TokenSource } {
  if (result.maxOutputTokens) {
    return { outputTokens: result.maxOutputTokens, outputTokenSource: "code" };
  }

  if (stats && stats.request_count >= 10) {
    return {
      outputTokens: Math.round(stats.avg_output_tokens),
      outputTokenSource: "production",
    };
  }

  if (pricing) {
    return {
      outputTokens: typicalOutputTokens(pricing),
      outputTokenSource: "typical",
    };
  }

  return { outputTokens: 0, outputTokenSource: "typical" };
}

function applyCalibration(
  tokens: number,
  source: TokenSource,
  calibration: CalibrationData | null,
  key: string,
  field: "inputRatio" | "outputRatio",
): { tokens: number; source: TokenSource } {
  if ((source !== "model_limit" && source !== "typical") || !calibration) return { tokens, source };
  const cal = calibration.models[key] as { inputRatio: number; outputRatio: number } | undefined;
  if (!cal) return { tokens, source };
  return { tokens: Math.round(tokens * cal[field]), source: "calibrated" };
}

function computeRowCost(
  result: ScanResult,
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
  statsMap: Map<string, ModelStats> | null,
  calibration: CalibrationData | null,
  unknownModels: Set<string>,
): EstimateRow {
  const provider = result.provider as Provider;
  const modelId = result.model;
  const volume = resolveVolume(config, result.filePath, cliVolume, cliVolumeExplicit);

  const directMatch = modelId ? getModel(provider, modelId) : undefined;
  const pricing = directMatch ?? fallbackModel(provider);

  if (modelId && !directMatch) {
    unknownModels.add(`${provider}/${modelId}`);
  }

  const stats = modelId ? statsMap?.get(`${provider}/${modelId}`) : undefined;

  let { inputTokens, inputTokenSource } = resolveInputTokens(result, pricing, stats);
  let { outputTokens, outputTokenSource } = resolveOutputTokens(result, pricing, stats);

  const calKey = `${provider}/${modelId}`;
  ({ tokens: inputTokens, source: inputTokenSource } = applyCalibration(
    inputTokens,
    inputTokenSource,
    calibration,
    calKey,
    "inputRatio",
  ));
  ({ tokens: outputTokens, source: outputTokenSource } = applyCalibration(
    outputTokens,
    outputTokenSource,
    calibration,
    calKey,
    "outputRatio",
  ));

  const costPerCall = pricing ? calculateCost({ model: pricing, inputTokens, outputTokens }) : 0;
  const monthlyCost = costPerCall * volume * 30;

  return {
    file: result.filePath,
    line: result.lineNumber,
    provider,
    model: modelId ?? (pricing ? `${pricing.id} (inferred)` : "unknown"),
    inputTokens,
    inputTokenSource,
    outputTokens,
    outputTokenSource,
    costPerCall,
    monthlyCost,
  };
}

/** Build estimate rows from scan results. Shared by estimate, check, and SDK. */
export function buildEstimateRows(
  results: ScanResult[],
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
  statsMap: Map<string, ModelStats> | null,
  calibration: CalibrationData | null,
): { rows: EstimateRow[]; unknownModels: Set<string> } {
  const unknownModels = new Set<string>();
  const rows = results.map((r) =>
    computeRowCost(r, config, cliVolume, cliVolumeExplicit, statsMap, calibration, unknownModels),
  );
  return { rows, unknownModels };
}
