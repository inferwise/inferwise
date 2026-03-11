import chalk from "chalk";
import { Command } from "commander";
import { loadCalibration } from "../calibration.js";
import { getEnvVolume, loadConfig } from "../config.js";
import { buildEstimateRows } from "../estimate-core.js";
import type { EstimateSummary, OutputFormat } from "../formatters/index.js";
import { formatJson, formatMarkdown, formatTable } from "../formatters/index.js";
import { scanDirectory } from "../scanners/index.js";

interface CheckOptions {
  volume: string;
  format: string;
  config?: string;
  maxMonthlyCost?: string;
  maxCostPerCall?: string;
}

function resolveFormat(raw: string): OutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

export function checkCommand(): Command {
  return new Command("check")
    .description("Verify LLM costs are within budget — exits with code 1 if over")
    .argument("[path]", "Path to scan", ".")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .option("--max-monthly-cost <amount>", "Max allowed total monthly cost (USD)")
    .option("--max-cost-per-call <amount>", "Max allowed cost per single LLM call (USD)")
    .action(async (scanPath: string, options: CheckOptions) => {
      const envVolume = getEnvVolume();
      const cliVolumeExplicit = options.volume !== "1000";
      const cliVolume = cliVolumeExplicit
        ? Math.max(1, Number.parseInt(options.volume, 10) || 1000)
        : (envVolume ?? Math.max(1, Number.parseInt(options.volume, 10) || 1000));
      const format = resolveFormat(options.format);

      const config = await loadConfig(options.config);
      const calibration = await loadCalibration();

      // Resolve thresholds: CLI flags > config budgets
      const maxMonthlyCost = options.maxMonthlyCost
        ? Number.parseFloat(options.maxMonthlyCost)
        : config.budgets?.block;
      const maxCostPerCall = options.maxCostPerCall
        ? Number.parseFloat(options.maxCostPerCall)
        : undefined;

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      }

      const results = await scanDirectory(scanPath, config.ignore);

      if (results.length === 0) {
        if (format === "table") {
          process.stdout.write(chalk.green("No LLM API calls detected. Budget OK.\n"));
        }
        return;
      }

      const { rows, unknownModels } = buildEstimateRows(
        results,
        config,
        cliVolume,
        cliVolumeExplicit,
        null,
        calibration,
      );

      // Warn about unknown models
      if (format === "table" && unknownModels.size > 0) {
        for (const model of unknownModels) {
          process.stderr.write(
            chalk.yellow(`Warning: Unknown model "${model}" — using fallback pricing.\n`),
          );
        }
      }

      const totalMonthlyCost = rows.reduce((sum, r) => sum + r.monthlyCost, 0);
      const summary: EstimateSummary = { rows, totalMonthlyCost, volume: cliVolume };

      // Print the estimate
      let output: string;
      if (format === "json") {
        output = formatJson(summary);
      } else if (format === "markdown") {
        output = formatMarkdown(summary);
      } else {
        output = formatTable(summary);
      }
      process.stdout.write(`${output}\n`);

      // Check budget violations
      const violations: string[] = [];

      if (maxMonthlyCost !== undefined && totalMonthlyCost > maxMonthlyCost) {
        violations.push(
          `Total monthly cost $${totalMonthlyCost.toFixed(2)} exceeds limit $${maxMonthlyCost.toFixed(2)}/mo`,
        );
      }

      if (maxCostPerCall !== undefined) {
        for (const row of rows) {
          if (row.costPerCall > maxCostPerCall) {
            violations.push(
              `${row.file}:${row.line} — ${row.model} costs $${row.costPerCall.toFixed(4)}/call (limit: $${maxCostPerCall.toFixed(4)})`,
            );
          }
        }
      }

      if (violations.length > 0) {
        process.stderr.write(chalk.red("\nBudget check FAILED:\n"));
        for (const v of violations) {
          process.stderr.write(chalk.red(`  ✗ ${v}\n`));
        }
        process.exit(1);
      }

      if (format === "table") {
        process.stderr.write(chalk.green("\nBudget check passed.\n"));
      }
    });
}
