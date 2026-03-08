import { calculateCost, getModel } from "@inferwise/pricing-db";
import type { Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import { formatJson, formatMarkdown, formatTable } from "../formatters/index.js";
import type { EstimateRow, EstimateSummary, OutputFormat } from "../formatters/index.js";
import { scanDirectory } from "../scanners/index.js";
import { countMessageTokens } from "../tokenizers/index.js";

// Default token estimates when prompts are dynamic
const DEFAULT_INPUT_TOKENS = 500;
const DEFAULT_OUTPUT_MULTIPLIER = 2.0;

interface EstimateOptions {
  volume: string;
  format: string;
  config?: string;
}

function resolveFormat(raw: string): OutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

export function estimateCommand(): Command {
  return new Command("estimate")
    .description("Scan a directory for LLM API calls and estimate costs")
    .argument("[path]", "Path to scan", ".")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (scanPath: string, options: EstimateOptions) => {
      const volume = Math.max(1, Number.parseInt(options.volume, 10) || 1000);
      const format = resolveFormat(options.format);

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      }

      const results = await scanDirectory(scanPath);

      if (format === "table" && results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const rows: EstimateRow[] = [];

      for (const result of results) {
        const provider = result.provider as Provider;
        const modelId = result.model;

        // Count input tokens from static prompts, or fall back to defaults
        let inputTokens: number;
        if (result.systemPrompt || result.userPrompt) {
          inputTokens = countMessageTokens(provider, modelId ?? "", {
            ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
            ...(result.userPrompt ? { user: result.userPrompt } : {}),
          });
        } else {
          inputTokens = DEFAULT_INPUT_TOKENS;
        }

        const outputTokens = Math.round(inputTokens * DEFAULT_OUTPUT_MULTIPLIER);

        // Look up pricing — skip if model unknown
        if (!modelId) {
          rows.push({
            file: result.filePath,
            line: result.lineNumber,
            provider,
            model: "unknown",
            inputTokens,
            outputTokens,
            costPerCall: 0,
            monthlyCost: 0,
            isDynamic: true,
          });
          continue;
        }

        const pricing = getModel(provider, modelId);

        let costPerCall = 0;
        if (pricing) {
          costPerCall = calculateCost({
            model: pricing,
            inputTokens,
            outputTokens,
          });
        }

        const monthlyCost = costPerCall * volume * 30;

        rows.push({
          file: result.filePath,
          line: result.lineNumber,
          provider,
          model: modelId,
          inputTokens,
          outputTokens,
          costPerCall,
          monthlyCost,
          isDynamic: result.isDynamic,
        });
      }

      const totalMonthlyCost = rows.reduce((sum, r) => sum + r.monthlyCost, 0);
      const summary: EstimateSummary = { rows, totalMonthlyCost, volume };

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
