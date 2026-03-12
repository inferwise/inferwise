import chalk from "chalk";
import { Command } from "commander";
import { loadCalibration } from "../calibration.js";
import type { InferwiseConfig } from "../config.js";
import { getEnvVolume, loadConfig, parseVolume } from "../config.js";
import { buildEstimateRows } from "../estimate-core.js";
import type { EstimateSummary, OutputFormat } from "../formatters/index.js";
import { formatJson, formatMarkdown, formatTable } from "../formatters/index.js";
import { scanDirectory } from "../scanners/index.js";
import type { ModelStats } from "../stats-client.js";
import { fetchProductionStats } from "../stats-client.js";

interface EstimateOptions {
  volume: string;
  format: string;
  config?: string;
  apiUrl?: string;
  apiKey?: string;
}

function resolveFormat(raw: string): OutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  if (raw !== "table") {
    process.stderr.write(`Warning: Unknown format "${raw}" — using table.\n`);
  }
  return "table";
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
      const envVolume = getEnvVolume();
      const cliVolumeExplicit = options.volume !== "1000";
      const cliVolume = cliVolumeExplicit
        ? parseVolume(options.volume, 1000)
        : (envVolume ?? parseVolume(options.volume, 1000));
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
