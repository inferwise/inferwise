import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import {
  calculateCost,
  getAllModels,
  getAllProviders,
  getModel,
  getProviderModels,
} from "@inferwise/pricing-db";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { parseVolume } from "../config.js";

type PriceOutputFormat = "table" | "json" | "markdown";

interface PriceOptions {
  inputTokens: string;
  outputTokens: string;
  volume: string;
  compare?: boolean;
  list?: string;
  listAll?: boolean;
  format: string;
  batch?: boolean;
  cache?: boolean;
  fast?: boolean;
}

const DAYS_PER_MONTH = 30;

function resolveFormat(raw: string): PriceOutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

function formatDollars(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

function formatRate(perMillion: number | undefined): string {
  if (perMillion === undefined) return chalk.dim("—");
  return `$${perMillion.toFixed(2)}`;
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatMonthly(usd: number, volume: number): string {
  const monthly = usd * volume * DAYS_PER_MONTH;
  return `${formatDollars(monthly)}/mo`;
}

/** Parse "provider/model" string into components. */
function parseModelRef(ref: string): { provider: string; modelId: string } | undefined {
  const slashIndex = ref.indexOf("/");
  if (slashIndex === -1) return undefined;
  return {
    provider: ref.slice(0, slashIndex),
    modelId: ref.slice(slashIndex + 1),
  };
}

/** Resolve a provider string to a valid Provider or return an error message. */
function resolveProvider(
  name: string,
): { ok: true; value: Provider } | { ok: false; error: string } {
  const providers = getAllProviders();
  if (providers.includes(name as Provider)) return { ok: true, value: name as Provider };
  return { ok: false, error: `Unknown provider "${name}". Available: ${providers.join(", ")}` };
}

/** Look up a model, returning the model or an error message. */
function resolveModel(
  provider: Provider,
  modelId: string,
): { ok: true; value: ModelPricing } | { ok: false; error: string } {
  const model = getModel(provider, modelId);
  if (model) return { ok: true, value: model };
  return { ok: false, error: `Unknown model "${modelId}" for provider "${provider}".` };
}

function computeCostPerCall(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  return calculateCost({ model, inputTokens, outputTokens });
}

function computeBatchCost(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (model.batch_input_cost_per_million === undefined) return undefined;
  return calculateCost({ model, inputTokens, outputTokens, useBatch: true });
}

function computeCachedCost(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (model.cache_read_input_cost_per_million === undefined) return undefined;
  return calculateCost({
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens: inputTokens,
  });
}

function computeFastCost(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (model.fast_input_cost_per_million === undefined) return undefined;
  return calculateCost({ model, inputTokens, outputTokens, useFast: true });
}

// ── Single model output ─────────────────────────────────────────────

function singleModelTable(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  volume: number,
  showBatch: boolean,
  showCache: boolean,
  showFast: boolean,
): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Model: ${model.id}`) + chalk.dim(` (${model.provider})`));
  lines.push(
    chalk.dim(
      `Tier: ${model.tier} | Context: ${formatContext(model.context_window)} tokens | Max Output: ${formatContext(model.max_output_tokens)} tokens`,
    ),
  );
  lines.push("");
  lines.push(chalk.bold("Pricing (per million tokens):"));
  lines.push(`  Input:        ${formatRate(model.input_cost_per_million)}`);
  lines.push(`  Output:       ${formatRate(model.output_cost_per_million)}`);

  if (showCache || model.cache_read_input_cost_per_million !== undefined) {
    lines.push(`  Cache Read:   ${formatRate(model.cache_read_input_cost_per_million)}`);
    lines.push(`  Cache Write:  ${formatRate(model.cache_write_input_cost_per_million)}`);
  }
  if (showBatch || model.batch_input_cost_per_million !== undefined) {
    lines.push(`  Batch Input:  ${formatRate(model.batch_input_cost_per_million)}`);
    lines.push(`  Batch Output: ${formatRate(model.batch_output_cost_per_million)}`);
  }
  if (showFast || model.fast_input_cost_per_million !== undefined) {
    lines.push(`  Fast Input:   ${formatRate(model.fast_input_cost_per_million)}`);
    lines.push(`  Fast Output:  ${formatRate(model.fast_output_cost_per_million)}`);
  }

  lines.push("");
  const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
  const tokLabel = `${inputTokens.toLocaleString()} input + ${outputTokens.toLocaleString()} output tokens`;
  lines.push(chalk.bold(`Cost Estimate (${tokLabel}):`));
  lines.push(
    `  Standard:  ${formatDollars(costPerCall)}/call  →  ${formatMonthly(costPerCall, volume)} at ${volume.toLocaleString()} req/day`,
  );

  const batchCost = computeBatchCost(model, inputTokens, outputTokens);
  if (batchCost !== undefined) {
    lines.push(
      `  Batch:     ${formatDollars(batchCost)}/call  →  ${formatMonthly(batchCost, volume)} at ${volume.toLocaleString()} req/day`,
    );
  }

  const cachedCost = computeCachedCost(model, inputTokens, outputTokens);
  if (cachedCost !== undefined) {
    lines.push(
      `  Cached:    ${formatDollars(cachedCost)}/call  →  ${formatMonthly(cachedCost, volume)} at ${volume.toLocaleString()} req/day`,
    );
  }

  const fastCost = computeFastCost(model, inputTokens, outputTokens);
  if (fastCost !== undefined) {
    lines.push(
      `  Fast:      ${formatDollars(fastCost)}/call  →  ${formatMonthly(fastCost, volume)} at ${volume.toLocaleString()} req/day`,
    );
  }

  return lines.join("\n");
}

function singleModelJson(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  volume: number,
): string {
  const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
  return JSON.stringify(
    {
      model: model.id,
      provider: model.provider,
      tier: model.tier,
      contextWindow: model.context_window,
      maxOutputTokens: model.max_output_tokens,
      pricing: {
        inputPerMillion: model.input_cost_per_million,
        outputPerMillion: model.output_cost_per_million,
        cacheReadPerMillion: model.cache_read_input_cost_per_million ?? null,
        cacheWritePerMillion: model.cache_write_input_cost_per_million ?? null,
        batchInputPerMillion: model.batch_input_cost_per_million ?? null,
        batchOutputPerMillion: model.batch_output_cost_per_million ?? null,
        fastInputPerMillion: model.fast_input_cost_per_million ?? null,
        fastOutputPerMillion: model.fast_output_cost_per_million ?? null,
      },
      estimate: {
        inputTokens,
        outputTokens,
        costPerCall,
        monthlyCost: costPerCall * volume * DAYS_PER_MONTH,
        volume,
      },
    },
    null,
    2,
  );
}

function singleModelMarkdown(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  volume: number,
): string {
  const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
  const monthly = costPerCall * volume * DAYS_PER_MONTH;
  const lines: string[] = [];
  lines.push(`## ${model.id} (${model.provider})`);
  lines.push("");
  lines.push(
    `**Tier:** ${model.tier} | **Context:** ${formatContext(model.context_window)} | **Max Output:** ${formatContext(model.max_output_tokens)}`,
  );
  lines.push("");
  lines.push("| Metric | Rate |");
  lines.push("|--------|------|");
  lines.push(`| Input/1M | $${model.input_cost_per_million.toFixed(2)} |`);
  lines.push(`| Output/1M | $${model.output_cost_per_million.toFixed(2)} |`);
  lines.push("");
  lines.push(
    `**Cost:** ${formatDollars(costPerCall)}/call → ${formatDollars(monthly)}/mo at ${volume.toLocaleString()} req/day`,
  );

  if (model.fast_input_cost_per_million !== undefined) {
    lines.push("");
    lines.push(`| Fast Input/1M | $${model.fast_input_cost_per_million.toFixed(2)} |`);
    lines.push(`| Fast Output/1M | $${(model.fast_output_cost_per_million ?? 0).toFixed(2)} |`);
    const fastCost = computeFastCost(model, inputTokens, outputTokens);
    if (fastCost !== undefined) {
      const fastMonthly = fastCost * volume * DAYS_PER_MONTH;
      lines.push("");
      lines.push(
        `**Fast Cost:** ${formatDollars(fastCost)}/call → ${formatDollars(fastMonthly)}/mo at ${volume.toLocaleString()} req/day`,
      );
    }
  }

  return lines.join("\n");
}

// ── Compare models ──────────────────────────────────────────────────

function compareTable(
  models: ModelPricing[],
  inputTokens: number,
  outputTokens: number,
  volume: number,
): string {
  const table = new Table({
    head: [
      chalk.bold("Model"),
      chalk.bold("Tier"),
      chalk.bold("Input/1M"),
      chalk.bold("Output/1M"),
      chalk.bold("Cost/Call"),
      chalk.bold(`Monthly (${volume.toLocaleString()}/day)`),
    ],
    style: { head: [], border: [] },
    colAligns: ["left", "left", "right", "right", "right", "right"],
  });

  for (const model of models) {
    const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
    const monthly = costPerCall * volume * DAYS_PER_MONTH;
    table.push([
      chalk.cyan(model.id),
      model.tier,
      `$${model.input_cost_per_million.toFixed(2)}`,
      `$${model.output_cost_per_million.toFixed(2)}`,
      formatDollars(costPerCall),
      `${formatDollars(monthly)}/mo`,
    ]);
  }

  return table.toString();
}

function compareJson(
  models: ModelPricing[],
  inputTokens: number,
  outputTokens: number,
  volume: number,
): string {
  const entries = models.map((model) => {
    const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
    return {
      model: model.id,
      provider: model.provider,
      tier: model.tier,
      inputPerMillion: model.input_cost_per_million,
      outputPerMillion: model.output_cost_per_million,
      costPerCall,
      monthlyCost: costPerCall * volume * DAYS_PER_MONTH,
    };
  });
  return JSON.stringify({ inputTokens, outputTokens, volume, models: entries }, null, 2);
}

function compareMarkdown(
  models: ModelPricing[],
  inputTokens: number,
  outputTokens: number,
  volume: number,
): string {
  const lines: string[] = [];
  lines.push("## Model Comparison");
  lines.push("");
  lines.push("| Model | Tier | Input/1M | Output/1M | Cost/Call | Monthly |");
  lines.push("|-------|------|----------|-----------|-----------|---------|");

  for (const model of models) {
    const costPerCall = computeCostPerCall(model, inputTokens, outputTokens);
    const monthly = costPerCall * volume * DAYS_PER_MONTH;
    lines.push(
      `| ${model.id} | ${model.tier} | $${model.input_cost_per_million.toFixed(2)} | $${model.output_cost_per_million.toFixed(2)} | ${formatDollars(costPerCall)} | ${formatDollars(monthly)}/mo |`,
    );
  }

  return lines.join("\n");
}

// ── List models ─────────────────────────────────────────────────────

function listTable(models: ModelPricing[], title: string): string {
  const table = new Table({
    head: [
      chalk.bold("Model"),
      chalk.bold("Tier"),
      chalk.bold("Input/1M"),
      chalk.bold("Output/1M"),
      chalk.bold("Context"),
      chalk.bold("Status"),
    ],
    style: { head: [], border: [] },
    colAligns: ["left", "left", "right", "right", "right", "left"],
  });

  for (const model of models) {
    table.push([
      chalk.cyan(model.id),
      model.tier,
      `$${model.input_cost_per_million.toFixed(2)}`,
      `$${model.output_cost_per_million.toFixed(2)}`,
      formatContext(model.context_window),
      model.status,
    ]);
  }

  return `${chalk.bold(title)}\n${table.toString()}`;
}

function listJson(models: ModelPricing[]): string {
  const entries = models.map((m) => ({
    id: m.id,
    provider: m.provider,
    tier: m.tier,
    status: m.status,
    inputPerMillion: m.input_cost_per_million,
    outputPerMillion: m.output_cost_per_million,
    contextWindow: m.context_window,
  }));
  return JSON.stringify({ models: entries }, null, 2);
}

function listMarkdown(models: ModelPricing[], title: string): string {
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| Model | Tier | Input/1M | Output/1M | Context | Status |");
  lines.push("|-------|------|----------|-----------|---------|--------|");

  for (const model of models) {
    lines.push(
      `| ${model.id} | ${model.tier} | $${model.input_cost_per_million.toFixed(2)} | $${model.output_cost_per_million.toFixed(2)} | ${formatContext(model.context_window)} | ${model.status} |`,
    );
  }

  return lines.join("\n");
}

// ── Action handlers ─────────────────────────────────────────────────

function handleListAll(format: PriceOutputFormat): void {
  const models = getAllModels();
  let output: string;
  if (format === "json") {
    output = listJson(models);
  } else if (format === "markdown") {
    output = listMarkdown(models, "All Models");
  } else {
    output = listTable(models, "All Models");
  }
  process.stdout.write(`${output}\n`);
}

function handleListProvider(providerName: string, format: PriceOutputFormat): void {
  const resolved = resolveProvider(providerName);
  if (!resolved.ok) {
    process.stderr.write(chalk.red(`${resolved.error}\n`));
    process.exit(1);
  }
  const provider = resolved.value;
  const models = getProviderModels(provider);
  const title = `${provider.charAt(0).toUpperCase() + provider.slice(1)} Models`;
  let output: string;
  if (format === "json") {
    output = listJson(models);
  } else if (format === "markdown") {
    output = listMarkdown(models, title);
  } else {
    output = listTable(models, title);
  }
  process.stdout.write(`${output}\n`);
}

function handleCompare(args: string[], options: PriceOptions, format: PriceOutputFormat): void {
  const inputTokens = Math.max(1, Number.parseInt(options.inputTokens, 10) || 1000);
  const outputTokens = Math.max(1, Number.parseInt(options.outputTokens, 10) || 1000);
  const volume = parseVolume(options.volume, 1000);

  const models: ModelPricing[] = [];
  for (const arg of args) {
    const ref = parseModelRef(arg);
    if (!ref) {
      process.stderr.write(chalk.red(`Invalid format "${arg}". Use provider/model.\n`));
      process.exit(1);
    }
    const providerResult = resolveProvider(ref.provider);
    if (!providerResult.ok) {
      process.stderr.write(chalk.red(`${providerResult.error}\n`));
      process.exit(1);
    }
    const modelResult = resolveModel(providerResult.value, ref.modelId);
    if (!modelResult.ok) {
      process.stderr.write(chalk.red(`${modelResult.error}\n`));
      process.exit(1);
    }
    models.push(modelResult.value);
  }

  if (models.length === 0) {
    process.stderr.write(chalk.red("No models specified for comparison.\n"));
    process.exit(1);
  }

  let output: string;
  if (format === "json") {
    output = compareJson(models, inputTokens, outputTokens, volume);
  } else if (format === "markdown") {
    output = compareMarkdown(models, inputTokens, outputTokens, volume);
  } else {
    output = compareTable(models, inputTokens, outputTokens, volume);
  }
  process.stdout.write(`${output}\n`);
}

function handleSingleModel(
  providerName: string,
  modelId: string,
  options: PriceOptions,
  format: PriceOutputFormat,
): void {
  const providerResult = resolveProvider(providerName);
  if (!providerResult.ok) {
    process.stderr.write(chalk.red(`${providerResult.error}\n`));
    process.exit(1);
  }
  const modelResult = resolveModel(providerResult.value, modelId);
  if (!modelResult.ok) {
    process.stderr.write(chalk.red(`${modelResult.error}\n`));
    process.exit(1);
  }

  const inputTokens = Math.max(1, Number.parseInt(options.inputTokens, 10) || 1000);
  const outputTokens = Math.max(1, Number.parseInt(options.outputTokens, 10) || 1000);
  const volume = parseVolume(options.volume, 1000);

  let output: string;
  if (format === "json") {
    output = singleModelJson(modelResult.value, inputTokens, outputTokens, volume);
  } else if (format === "markdown") {
    output = singleModelMarkdown(modelResult.value, inputTokens, outputTokens, volume);
  } else {
    output = singleModelTable(
      modelResult.value,
      inputTokens,
      outputTokens,
      volume,
      options.batch === true,
      options.cache === true,
      options.fast === true,
    );
  }
  process.stdout.write(`${output}\n`);
}

// ── Command definition ──────────────────────────────────────────────

export function priceCommand(): Command {
  return new Command("price")
    .description("Look up model pricing, compare models, or list available models")
    .argument("[provider]", "Provider name (anthropic, openai, google, xai)")
    .argument("[model]", "Model ID or alias")
    .option("--input-tokens <n>", "Number of input tokens", "1000")
    .option("--output-tokens <n>", "Number of output tokens", "1000")
    .option("--volume <n>", "Requests/day for monthly projection", "1000")
    .option("--compare", "Compare multiple models (args as provider/model pairs)")
    .option("--list <provider>", "List all models for a provider")
    .option("--list-all", "List all models across all providers")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--batch", "Show batch pricing if available")
    .option("--cache", "Show cache pricing if available")
    .option("--fast", "Show fast/priority mode pricing if available")
    .allowUnknownOption(false)
    .action(
      (
        provider: string | undefined,
        model: string | undefined,
        options: PriceOptions,
        cmd: Command,
      ) => {
        const format = resolveFormat(options.format);

        if (options.listAll) {
          handleListAll(format);
          return;
        }

        if (options.list) {
          handleListProvider(options.list, format);
          return;
        }

        if (options.compare) {
          // cmd.args contains all positional arguments passed to the command
          handleCompare(cmd.args, options, format);
          return;
        }

        if (!provider || !model) {
          process.stderr.write(
            chalk.red(
              "Please specify a provider and model, or use --list, --list-all, or --compare.\n",
            ),
          );
          process.stderr.write(
            chalk.dim("Example: inferwise price anthropic claude-sonnet-4-20250514\n"),
          );
          process.exit(1);
        }

        handleSingleModel(provider, model, options, format);
      },
    );
}
