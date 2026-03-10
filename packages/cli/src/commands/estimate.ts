import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import type { CalibrationData } from "../calibration.js";
import { loadCalibration } from "../calibration.js";
import type { InferwiseConfig } from "../config.js";
import { getEnvVolume, loadConfig, resolveVolume } from "../config.js";
import { formatJson, formatMarkdown, formatTable } from "../formatters/index.js";
import type {
  EstimateRow,
  EstimateSummary,
  OutputFormat,
  TokenSource,
} from "../formatters/index.js";
import { scanDirectory } from "../scanners/index.js";
import type { ScanResult } from "../scanners/index.js";
import type { ModelStats } from "../stats-client.js";
import { fetchProductionStats } from "../stats-client.js";
import { countMessageTokens } from "../tokenizers/index.js";

interface EstimateOptions {
  volume: string;
  format: string;
  config?: string;
  apiUrl?: string;
  apiKey?: string;
}

function resolveFormat(raw: string): OutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

/** When model is unknown, use the cheapest current model for the provider as a floor. */
function fallbackModel(provider: Provider): ModelPricing | undefined {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return undefined;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}

/**
 * Typical input token heuristic.
 *
 * Most LLM calls use a small fraction of the context window.
 * Rather than using context_window (e.g. 1M tokens) as a ceiling,
 * we estimate based on observed industry patterns:
 *
 * - Median LLM input across production workloads is ~2K-8K tokens
 *   (source: Anthropic cookbook, OpenAI tokenizer docs, Helicone public benchmarks)
 * - We use 4,096 tokens as a baseline typical input
 * - For models with very small context windows (<16K), we use 25% of context
 *
 * See HEURISTICS.md for full methodology and sources.
 */
function typicalInputTokens(pricing: ModelPricing): number {
  const TYPICAL_INPUT = 4096;
  // For small-context models, don't exceed 25% of window
  if (pricing.context_window < 16_384) {
    return Math.min(TYPICAL_INPUT, Math.round(pricing.context_window * 0.25));
  }
  return TYPICAL_INPUT;
}

/**
 * Typical output token heuristic.
 *
 * Most LLM responses are well under max_output_tokens.
 * Industry data shows median output is ~500-2K tokens:
 *
 * - Chat/conversational: ~200-800 tokens
 * - Code generation: ~500-2000 tokens
 * - Summarization/analysis: ~1000-3000 tokens
 *
 * We use 5% of max_output_tokens with floor=512, ceiling=4096.
 * This gives reasonable estimates across model tiers:
 *   - Haiku (8K max): 512 tokens
 *   - Sonnet (64K max): 3,200 tokens
 *   - GPT-4o (16K max): 820 tokens
 *
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
  // Static prompt available — tokenize it (exact)
  if (result.systemPrompt || result.userPrompt) {
    const tokens = countMessageTokens(result.provider, result.model ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
    return { inputTokens: tokens, inputTokenSource: "code" };
  }

  // Production stats available — use real average instead of worst-case ceiling
  if (stats && stats.request_count >= 10) {
    return {
      inputTokens: Math.round(stats.avg_input_tokens),
      inputTokenSource: "production",
    };
  }

  // Dynamic prompt — use typical heuristic instead of worst-case ceiling
  if (pricing) {
    return {
      inputTokens: typicalInputTokens(pricing),
      inputTokenSource: "typical",
    };
  }

  // Should not reach here if fallbackModel works, but safety net
  return { inputTokens: 0, inputTokenSource: "typical" };
}

function resolveOutputTokens(
  result: ScanResult,
  pricing: ModelPricing | undefined,
  stats: ModelStats | undefined,
): { outputTokens: number; outputTokenSource: TokenSource } {
  // max_tokens extracted from code — exact
  if (result.maxOutputTokens) {
    return { outputTokens: result.maxOutputTokens, outputTokenSource: "code" };
  }

  // Production stats available — use real average instead of worst-case ceiling
  if (stats && stats.request_count >= 10) {
    return {
      outputTokens: Math.round(stats.avg_output_tokens),
      outputTokenSource: "production",
    };
  }

  // Model known — use typical heuristic instead of worst-case ceiling
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
  // Calibration improves both typical heuristics and model_limit ceilings
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

  // Resolve model — use exact match or fall back to cheapest for provider
  const directMatch = modelId ? getModel(provider, modelId) : undefined;
  const pricing = directMatch ?? fallbackModel(provider);

  // Track unknown models for warning
  if (modelId && !directMatch) {
    unknownModels.add(`${provider}/${modelId}`);
  }

  // Look up production stats for this provider/model
  const stats = modelId ? statsMap?.get(`${provider}/${modelId}`) : undefined;

  let { inputTokens, inputTokenSource } = resolveInputTokens(result, pricing, stats);
  let { outputTokens, outputTokenSource } = resolveOutputTokens(result, pricing, stats);

  // Apply calibration to model_limit estimates only
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

function buildEstimateRows(
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

/** Resolve API URL from CLI flag, config, or env var. */
function resolveApiUrl(options: EstimateOptions, config: InferwiseConfig): string | undefined {
  return options.apiUrl ?? config.apiUrl ?? process.env.INFERWISE_API_URL;
}

/** Resolve API key from CLI flag, config, or env var. */
function resolveApiKey(options: EstimateOptions, config: InferwiseConfig): string | undefined {
  return options.apiKey ?? config.apiKey ?? process.env.INFERWISE_API_KEY;
}

export function estimateCommand(): Command {
  return new Command("estimate")
    .description("Scan a directory for LLM API calls and estimate costs")
    .argument("[path]", "Path to scan", ".")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .option("--api-url <url>", "Inferwise Cloud API URL for production stats")
    .option("--api-key <key>", "Inferwise Cloud API key")
    .option("--precise", "Use provider APIs for exact token counts (requires API keys)")
    .action(async (scanPath: string, options: EstimateOptions) => {
      const envVolume = getEnvVolume();
      const cliVolumeExplicit = options.volume !== "1000";
      const cliVolume = cliVolumeExplicit
        ? Math.max(1, Number.parseInt(options.volume, 10) || 1000)
        : (envVolume ?? Math.max(1, Number.parseInt(options.volume, 10) || 1000));
      const format = resolveFormat(options.format);

      const config = await loadConfig(options.config);

      // Fetch production stats if API credentials are available
      const apiUrl = resolveApiUrl(options, config);
      const apiKey = resolveApiKey(options, config);
      let statsMap: Map<string, ModelStats> | null = null;

      if (apiUrl && apiKey) {
        if (format === "table") {
          process.stderr.write(chalk.dim("Fetching production stats...\n"));
        }
        statsMap = await fetchProductionStats(apiUrl, apiKey);
      }

      // Load calibration data if available
      const calibration = await loadCalibration();

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      }

      const results = await scanDirectory(scanPath, config.ignore);

      if (format === "table" && results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const { rows, unknownModels } = buildEstimateRows(
        results,
        config,
        cliVolume,
        cliVolumeExplicit,
        statsMap,
        calibration,
      );

      // Warn about unknown models not in pricing DB
      if (format === "table" && unknownModels.size > 0) {
        for (const model of unknownModels) {
          process.stderr.write(
            chalk.yellow(`Warning: Unknown model "${model}" — using fallback pricing.\n`),
          );
        }
        process.stderr.write(
          chalk.dim("Report missing models at https://github.com/inferwise/inferwise/issues\n"),
        );
      }

      const totalMonthlyCost = rows.reduce((sum, r) => sum + r.monthlyCost, 0);
      const summary: EstimateSummary = { rows, totalMonthlyCost, volume: cliVolume };

      let output: string;
      if (format === "json") {
        output = formatJson(summary);
      } else if (format === "markdown") {
        output = formatMarkdown(summary);
      } else {
        output = formatTable(summary);
      }

      process.stdout.write(`${output}\n`);
    });
}
