import { getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import type { CalibrationData, ModelCalibration } from "../calibration.js";
import { computeModelCalibration, saveCalibration } from "../calibration.js";
import { loadConfig } from "../config.js";
import { PROVIDER_ENV_KEYS, SUPPORTED_PROVIDERS, fetchProviderUsage } from "../providers/index.js";
import type { ProviderUsageRecord, ProviderUsageResult } from "../providers/index.js";
import { scanDirectory } from "../scanners/index.js";
import type { ScanResult } from "../scanners/index.js";
import { countMessageTokens } from "../tokenizers/index.js";

interface CalibrateOptions {
  provider?: string;
  dryRun?: boolean;
  days: string;
  format: string;
  config?: string;
}

/** Get estimated average input tokens for a model (same logic as estimate command). */
function estimateInputTokens(result: ScanResult, pricing: ModelPricing | undefined): number {
  if (result.systemPrompt || result.userPrompt) {
    return countMessageTokens(result.provider, result.model ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
  }
  if (pricing) return pricing.context_window - pricing.max_output_tokens;
  return 0;
}

/** Get estimated average output tokens for a model (same logic as estimate command). */
function estimateOutputTokens(result: ScanResult, pricing: ModelPricing | undefined): number {
  if (result.maxOutputTokens) return result.maxOutputTokens;
  if (pricing) return pricing.max_output_tokens;
  return 0;
}

/** Get the cheapest current model for a provider as fallback. */
function fallbackModel(provider: Provider): ModelPricing | undefined {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return undefined;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}

interface ModelEstimate {
  provider: Provider;
  model: string;
  avgInput: number;
  avgOutput: number;
  callCount: number;
}

/** Group scan results by provider/model and compute average estimated tokens. */
function groupEstimates(results: ScanResult[]): Map<string, ModelEstimate> {
  const groups = new Map<
    string,
    { inputs: number[]; outputs: number[]; provider: Provider; model: string }
  >();

  for (const r of results) {
    if (!r.model) continue;
    const key = `${r.provider}/${r.model}`;
    const pricing =
      getModel(r.provider as Provider, r.model) ?? fallbackModel(r.provider as Provider);
    const input = estimateInputTokens(r, pricing);
    const output = estimateOutputTokens(r, pricing);

    const group = groups.get(key) ?? {
      inputs: [],
      outputs: [],
      provider: r.provider as Provider,
      model: r.model,
    };
    group.inputs.push(input);
    group.outputs.push(output);
    groups.set(key, group);
  }

  const estimates = new Map<string, ModelEstimate>();
  for (const [key, group] of groups) {
    const avgInput = Math.round(group.inputs.reduce((a, b) => a + b, 0) / group.inputs.length);
    const avgOutput = Math.round(group.outputs.reduce((a, b) => a + b, 0) / group.outputs.length);
    estimates.set(key, {
      provider: group.provider,
      model: group.model,
      avgInput,
      avgOutput,
      callCount: group.inputs.length,
    });
  }

  return estimates;
}

/** Determine which providers to calibrate based on scan results and options. */
function resolveProviders(
  estimates: Map<string, ModelEstimate>,
  providerFilter?: string,
): Provider[] {
  if (providerFilter) {
    return [providerFilter as Provider];
  }
  const seen = new Set<Provider>();
  for (const est of estimates.values()) {
    seen.add(est.provider);
  }
  return [...seen];
}

interface CalibrationRow {
  key: string;
  provider: string;
  model: string;
  estInput: number;
  actualInput: number;
  inputRatio: number;
  estOutput: number;
  actualOutput: number;
  outputRatio: number;
  samples: number;
  confidence: string;
}

/** Build calibration rows from estimates + actual usage. */
function buildCalibrationRows(
  estimates: Map<string, ModelEstimate>,
  usageResults: ProviderUsageResult[],
): CalibrationRow[] {
  const rows: CalibrationRow[] = [];

  for (const usage of usageResults) {
    for (const record of usage.records) {
      const key = `${usage.provider}/${record.model}`;
      const est = estimates.get(key);
      if (!est) continue;

      const cal = computeModelCalibration(
        est.avgInput,
        est.avgOutput,
        record.avgInputTokens,
        record.avgOutputTokens,
        record.requestCount,
      );

      rows.push({
        key,
        provider: usage.provider,
        model: record.model,
        estInput: est.avgInput,
        actualInput: record.avgInputTokens,
        inputRatio: cal.inputRatio,
        estOutput: est.avgOutput,
        actualOutput: record.avgOutputTokens,
        outputRatio: cal.outputRatio,
        samples: record.requestCount,
        confidence: cal.confidence,
      });
    }
  }

  return rows.sort((a, b) => b.samples - a.samples);
}

/** Format comparison table for terminal output. */
function formatCalibrationTable(rows: CalibrationRow[]): string {
  if (rows.length === 0)
    return chalk.yellow("No matching models found between codebase and provider usage data.");

  const table = new Table({
    head: [
      chalk.bold("Provider"),
      chalk.bold("Model"),
      chalk.bold("Est. Input"),
      chalk.bold("Actual Input"),
      chalk.bold("Input Ratio"),
      chalk.bold("Est. Output"),
      chalk.bold("Actual Output"),
      chalk.bold("Output Ratio"),
      chalk.bold("Samples"),
      chalk.bold("Confidence"),
    ],
    style: { head: [], border: [] },
    colAligns: [
      "left",
      "left",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
      "left",
    ],
  });

  for (const row of rows) {
    table.push([
      row.provider,
      row.model,
      row.estInput.toLocaleString(),
      row.actualInput.toLocaleString(),
      formatRatio(row.inputRatio),
      row.estOutput.toLocaleString(),
      row.actualOutput.toLocaleString(),
      formatRatio(row.outputRatio),
      row.samples.toLocaleString(),
      formatConfidence(row.confidence),
    ]);
  }

  return table.toString();
}

function formatRatio(ratio: number): string {
  const pct = (ratio * 100).toFixed(1);
  if (ratio < 0.5) return chalk.green(`${pct}%`);
  if (ratio > 1.5) return chalk.red(`${pct}%`);
  return chalk.yellow(`${pct}%`);
}

function formatConfidence(confidence: string): string {
  if (confidence === "high") return chalk.green(confidence);
  if (confidence === "medium") return chalk.yellow(confidence);
  return chalk.red(confidence);
}

/** Build CalibrationData from rows. */
function buildCalibrationData(rows: CalibrationRow[]): CalibrationData {
  const models: Record<string, ModelCalibration> = {};
  for (const row of rows) {
    models[row.key] = computeModelCalibration(
      row.estInput,
      row.estOutput,
      row.actualInput,
      row.actualOutput,
      row.samples,
    );
  }
  return {
    version: 1,
    calibratedAt: new Date().toISOString(),
    models,
  };
}

export function calibrateCommand(): Command {
  return new Command("calibrate")
    .description("Compare estimates against actual provider usage to improve accuracy")
    .argument("[path]", "Path to scan", ".")
    .option("--provider <name>", "Calibrate only one provider")
    .option("--dry-run", "Show comparison without saving calibration data")
    .option("--days <number>", "Usage period in days", "30")
    .option("--format <table|json>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (scanPath: string, options: CalibrateOptions) => {
      const days = Math.max(1, Number.parseInt(options.days, 10) || 30);
      const config = await loadConfig(options.config);

      process.stderr.write(chalk.dim(`Scanning ${scanPath}...\n`));
      const results = await scanDirectory(scanPath, config.ignore);

      if (results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const estimates = groupEstimates(results);
      const providers = resolveProviders(estimates, options.provider);

      // Check which providers have API keys and fetch usage
      const usageResults: ProviderUsageResult[] = [];
      const skipped: string[] = [];

      for (const provider of providers) {
        const envKey = PROVIDER_ENV_KEYS[provider];
        if (!process.env[envKey] && SUPPORTED_PROVIDERS.includes(provider)) {
          skipped.push(`${provider} (set ${envKey})`);
          continue;
        }

        if (!SUPPORTED_PROVIDERS.includes(provider)) {
          skipped.push(`${provider} (no usage API available)`);
          continue;
        }

        process.stderr.write(chalk.dim(`Fetching ${provider} usage data (last ${days} days)...\n`));
        try {
          const usage = await fetchProviderUsage(provider, days);
          if (usage && usage.records.length > 0) {
            usageResults.push(usage);
          } else {
            skipped.push(`${provider} (no usage data returned)`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(chalk.red(`Failed to fetch ${provider} usage: ${msg}\n`));
        }
      }

      if (skipped.length > 0) {
        process.stderr.write(chalk.dim(`Skipped: ${skipped.join(", ")}\n`));
      }

      if (usageResults.length === 0) {
        process.stdout.write(
          chalk.yellow("No provider usage data available. Set API keys to enable calibration.\n"),
        );
        return;
      }

      const rows = buildCalibrationRows(estimates, usageResults);

      if (options.format === "json") {
        const data = buildCalibrationData(rows);
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatCalibrationTable(rows)}\n`);
      }

      if (rows.length === 0) return;

      if (options.dryRun) {
        process.stderr.write(chalk.dim("Dry run — calibration data not saved.\n"));
        return;
      }

      const data = buildCalibrationData(rows);
      const filePath = await saveCalibration(data, scanPath === "." ? undefined : scanPath);
      process.stderr.write(chalk.green(`Calibration data saved to ${filePath}\n`));
      process.stderr.write(
        chalk.dim("Future estimates will use these correction factors automatically.\n"),
      );
    });
}
