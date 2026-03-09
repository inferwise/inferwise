import { calculateCost, getModel } from "@inferwise/pricing-db";
import type { Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import type { InferwiseConfig } from "../config.js";
import { loadConfig, resolveVolume } from "../config.js";
import { formatJson, formatMarkdown, formatTable } from "../formatters/index.js";
import type {
  EstimateRow,
  EstimateSummary,
  OutputFormat,
  OutputTokenSource,
} from "../formatters/index.js";
import { scanDirectory } from "../scanners/index.js";
import type { ScanResult } from "../scanners/index.js";
import { countMessageTokens } from "../tokenizers/index.js";

interface EstimateOptions {
  volume: string;
  format: string;
  config?: string;
}

function resolveFormat(raw: string): OutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

function computeRowCost(
  result: ScanResult,
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
): EstimateRow {
  const provider = result.provider as Provider;
  const modelId = result.model;
  const volume = resolveVolume(config, result.filePath, cliVolume, cliVolumeExplicit);

  // Input tokens: tokenize static prompts, or 0 if dynamic (unknown)
  let inputTokens = 0;
  if (result.systemPrompt || result.userPrompt) {
    inputTokens = countMessageTokens(provider, modelId ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
  }

  const pricing = modelId ? getModel(provider, modelId) : undefined;

  // Output tokens: explicit max_tokens > model's max_output_tokens > unavailable
  let outputTokens = 0;
  let outputTokenSource: OutputTokenSource;

  if (result.maxOutputTokens) {
    outputTokens = result.maxOutputTokens;
    outputTokenSource = "max_tokens";
  } else if (pricing) {
    outputTokens = pricing.max_output_tokens;
    outputTokenSource = "model_limit";
  } else {
    outputTokenSource = "unavailable";
  }

  const costPerCall = pricing ? calculateCost({ model: pricing, inputTokens, outputTokens }) : 0;
  const monthlyCost = costPerCall * volume * 30;

  return {
    file: result.filePath,
    line: result.lineNumber,
    provider,
    model: modelId ?? "unknown",
    inputTokens,
    outputTokens,
    outputTokenSource,
    costPerCall,
    monthlyCost,
    isDynamic: result.isDynamic,
  };
}

function buildEstimateRows(
  results: ScanResult[],
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
): EstimateRow[] {
  return results.map((r) => computeRowCost(r, config, cliVolume, cliVolumeExplicit));
}

export function estimateCommand(): Command {
  return new Command("estimate")
    .description("Scan a directory for LLM API calls and estimate costs")
    .argument("[path]", "Path to scan", ".")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (scanPath: string, options: EstimateOptions) => {
      const cliVolume = Math.max(1, Number.parseInt(options.volume, 10) || 1000);
      const cliVolumeExplicit = options.volume !== "1000";
      const format = resolveFormat(options.format);

      const config = await loadConfig(options.config);

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      }

      const results = await scanDirectory(scanPath, config.ignore);

      if (format === "table" && results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const rows: EstimateRow[] = buildEstimateRows(results, config, cliVolume, cliVolumeExplicit);

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
