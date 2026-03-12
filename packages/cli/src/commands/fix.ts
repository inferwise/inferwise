import type { Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import { getEnvVolume, loadConfig, parseVolume } from "../config.js";
import type { ModelSwap } from "../fix-core.js";
import { applyRecommendations } from "../fix-core.js";
import { scanDirectory } from "../scanners/index.js";
import { detectSmartAlternatives } from "./audit.js";

interface FixOptions {
  volume: string;
  config?: string;
  dryRun?: boolean;
  provider?: string;
  minSavings: string;
  format: string;
}

export function fixCommand(): Command {
  return new Command("fix")
    .description("Auto-apply model swap recommendations from audit")
    .argument("[path]", "Path to scan and fix", ".")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--config <path>", "Path to inferwise.config.json")
    .option("--dry-run", "Preview changes without modifying files")
    .option("--provider <name>", "Only fix models from this provider")
    .option("--min-savings <amount>", "Minimum monthly savings to apply a fix (USD)", "0")
    .option("--format <table|json>", "Output format", "table")
    .action(async (scanPath: string, options: FixOptions) => {
      const envVolume = getEnvVolume();
      const cliVolumeExplicit = options.volume !== "1000";
      const cliVolume = cliVolumeExplicit
        ? parseVolume(options.volume, 1000)
        : (envVolume ?? parseVolume(options.volume, 1000));

      const minSavings = Number.parseFloat(options.minSavings) || 0;
      const config = await loadConfig(options.config);
      const dryRun = options.dryRun ?? false;

      process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      const results = await scanDirectory(scanPath, config.ignore);

      if (results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      process.stderr.write(chalk.dim("Analyzing model alternatives...\n"));
      const findings = detectSmartAlternatives(results, cliVolume);

      if (findings.length === 0) {
        process.stdout.write(chalk.yellow("No model swap recommendations found.\n"));
        return;
      }

      // Filter by provider and min savings
      let filtered = findings;
      if (options.provider) {
        const provider = options.provider as Provider;
        filtered = filtered.filter((f) => f.currentProvider === provider);
      }
      if (minSavings > 0) {
        filtered = filtered.filter((f) => f.monthlySavings >= minSavings);
      }

      if (filtered.length === 0) {
        process.stdout.write(chalk.yellow("No recommendations match your filters.\n"));
        return;
      }

      // Build swaps from findings
      const swaps: ModelSwap[] = filtered.map((f) => ({
        file: f.file,
        line: f.line,
        currentModel: f.currentModel,
        suggestedModel: f.suggestedModel,
        monthlySavings: f.monthlySavings,
      }));

      const result = await applyRecommendations(swaps, scanPath, dryRun);

      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      // Table output
      if (result.applied.length > 0) {
        const verb = dryRun ? "Would apply" : "Applied";
        process.stdout.write(chalk.green(`${verb} ${result.totalApplied} model swap(s):\n\n`));
        for (const swap of result.applied) {
          process.stdout.write(
            `  ${chalk.cyan(swap.file)}:${swap.line}  ${chalk.red(swap.from)} ${chalk.dim("->")} ${chalk.green(swap.to)}\n`,
          );
        }
      }

      if (result.skipped.length > 0) {
        process.stdout.write(
          chalk.yellow(`\nSkipped ${result.totalSkipped} recommendation(s):\n\n`),
        );
        for (const skip of result.skipped) {
          process.stdout.write(
            `  ${chalk.cyan(skip.file)}:${skip.line}  ${chalk.dim(skip.reason)}\n`,
          );
        }
      }

      if (result.estimatedMonthlySavings > 0) {
        process.stdout.write(
          `\n${chalk.bold("Estimated savings:")} ${chalk.green(`$${result.estimatedMonthlySavings.toFixed(0)}/mo`)}\n`,
        );
      }

      if (dryRun && result.totalApplied > 0) {
        process.stdout.write(chalk.dim("\nDry run — no files were modified.\n"));
      }
    });
}
