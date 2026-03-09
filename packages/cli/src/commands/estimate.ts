import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import type { InferwiseConfig } from "../config.js";
import { loadConfig, resolveVolume } from "../config.js";
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

  // Dynamic prompt — use model's context_window minus max_output_tokens as worst-case
  if (pricing) {
    return {
      inputTokens: pricing.context_window - pricing.max_output_tokens,
      inputTokenSource: "model_limit",
    };
  }

  // Should not reach here if fallbackModel works, but safety net
  return { inputTokens: 0, inputTokenSource: "model_limit" };
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

  // Model known — use its max_output_tokens as worst-case ceiling
  if (pricing) {
    return {
      outputTokens: pricing.max_output_tokens,
      outputTokenSource: "model_limit",
    };
  }

  return { outputTokens: 0, outputTokenSource: "model_limit" };
}

function computeRowCost(
  result: ScanResult,
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
  statsMap: Map<string, ModelStats> | null,
): EstimateRow {
  const provider = result.provider as Provider;
  const modelId = result.model;
  const volume = resolveVolume(config, result.filePath, cliVolume, cliVolumeExplicit);

  // Resolve model — use exact match or fall back to cheapest for provider
  const pricing = modelId ? getModel(provider, modelId) : fallbackModel(provider);

  // Look up production stats for this provider/model
  const stats = modelId ? statsMap?.get(`${provider}/${modelId}`) : undefined;

  const { inputTokens, inputTokenSource } = resolveInputTokens(result, pricing, stats);
  const { outputTokens, outputTokenSource } = resolveOutputTokens(result, pricing, stats);

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
): EstimateRow[] {
  return results.map((r) => computeRowCost(r, config, cliVolume, cliVolumeExplicit, statsMap));
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
    .action(async (scanPath: string, options: EstimateOptions) => {
      const cliVolume = Math.max(1, Number.parseInt(options.volume, 10) || 1000);
      const cliVolumeExplicit = options.volume !== "1000";
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

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      }

      const results = await scanDirectory(scanPath, config.ignore);

      if (format === "table" && results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const rows: EstimateRow[] = buildEstimateRows(
        results,
        config,
        cliVolume,
        cliVolumeExplicit,
        statsMap,
      );

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
