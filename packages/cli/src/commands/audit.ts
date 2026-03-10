import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, ModelTier, Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import { Command } from "commander";
import { getEnvVolume, loadConfig, resolveVolume } from "../config.js";
import { scanDirectory } from "../scanners/index.js";
import type { ScanResult } from "../scanners/index.js";
import { countMessageTokens } from "../tokenizers/index.js";

const DAYS_PER_MONTH = 30;

type AuditOutputFormat = "table" | "json" | "markdown";

interface AuditOptions {
  volume: string;
  format: string;
  config?: string;
}

interface CheaperModelFinding {
  type: "cheaper-model";
  file: string;
  line: number;
  provider: Provider;
  currentModel: string;
  suggestedModel: string;
  currentMonthlyCost: number;
  suggestedMonthlyCost: number;
  monthlySavings: number;
}

interface CachingFinding {
  type: "caching";
  systemPrompt: string;
  locations: Array<{ file: string; line: number }>;
  provider: Provider;
  model: string;
  currentMonthlyCost: number;
  monthlySavings: number;
}

interface BatchFinding {
  type: "batch";
  file: string;
  model: string;
  provider: Provider;
  callCount: number;
  currentMonthlyCost: number;
  monthlySavings: number;
}

type AuditFinding = CheaperModelFinding | CachingFinding | BatchFinding;

interface AuditSummary {
  findings: AuditFinding[];
  totalSavings: number;
  volume: number;
}

// ── Tier ordering for downgrade suggestions ─────────────────────────

const TIER_ORDER: Record<ModelTier, number> = {
  budget: 0,
  mid: 1,
  premium: 2,
};

function resolveFormat(raw: string): AuditOutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

// ── Token + cost helpers ────────────────────────────────────────────

function resolveInputTokens(result: ScanResult, model: ModelPricing | undefined): number {
  if (result.systemPrompt || result.userPrompt) {
    return countMessageTokens(result.provider, result.model ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
  }
  // Typical heuristic: 4K tokens for most prompts, 25% of window for small-context models
  if (model) {
    return model.context_window < 16_384
      ? Math.min(4096, Math.round(model.context_window * 0.25))
      : 4096;
  }
  return 0;
}

function resolveOutputTokens(result: ScanResult, model: ModelPricing | undefined): number {
  if (result.maxOutputTokens) return result.maxOutputTokens;
  // Typical heuristic: 5% of max output, clamped to [512, 4096]
  if (model) return Math.max(512, Math.min(4096, Math.round(model.max_output_tokens * 0.05)));
  return 0;
}

function monthlyCostForModel(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  volume: number,
): number {
  const costPerCall = calculateCost({ model, inputTokens, outputTokens });
  return costPerCall * volume * DAYS_PER_MONTH;
}

// ── Finding: cheaper model alternatives ─────────────────────────────

function findCheaperAlternative(
  provider: Provider,
  currentModelId: string,
  currentTier: ModelTier,
): ModelPricing | undefined {
  const models = getProviderModels(provider);
  const currentTierOrder = TIER_ORDER[currentTier];
  if (currentTierOrder === 0) return undefined;

  const candidates = models.filter(
    (m) =>
      m.status === "current" &&
      m.id !== currentModelId &&
      TIER_ORDER[m.tier] === currentTierOrder - 1,
  );

  if (candidates.length === 0) return undefined;

  // Return the cheapest candidate by input cost
  candidates.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return candidates[0];
}

function detectCheaperModels(results: ScanResult[], volume: number): CheaperModelFinding[] {
  const findings: CheaperModelFinding[] = [];

  for (const result of results) {
    if (!result.model) continue;
    const provider = result.provider;
    const pricing = getModel(provider, result.model);
    if (!pricing) continue;

    const alt = findCheaperAlternative(provider, pricing.id, pricing.tier);
    if (!alt) continue;

    const inputTokens = resolveInputTokens(result, pricing);
    const outputTokens = resolveOutputTokens(result, pricing);
    const currentCost = monthlyCostForModel(pricing, inputTokens, outputTokens, volume);
    const altCost = monthlyCostForModel(alt, inputTokens, outputTokens, volume);
    const savings = currentCost - altCost;

    if (savings <= 0) continue;

    findings.push({
      type: "cheaper-model",
      file: result.filePath,
      line: result.lineNumber,
      provider,
      currentModel: pricing.id,
      suggestedModel: alt.id,
      currentMonthlyCost: currentCost,
      suggestedMonthlyCost: altCost,
      monthlySavings: savings,
    });
  }

  return findings;
}

// ── Finding: prompt caching opportunities ───────────────────────────

function detectCachingOpportunities(results: ScanResult[], volume: number): CachingFinding[] {
  const promptMap = new Map<string, Array<{ file: string; line: number; result: ScanResult }>>();

  for (const result of results) {
    if (!result.systemPrompt) continue;
    const key = result.systemPrompt.trim();
    const existing = promptMap.get(key) ?? [];
    existing.push({ file: result.filePath, line: result.lineNumber, result });
    promptMap.set(key, existing);
  }

  const findings: CachingFinding[] = [];

  for (const [prompt, locations] of promptMap) {
    if (locations.length < 2) continue;

    const first = locations[0];
    if (!first) continue;

    const result = first.result;
    if (!result.model) continue;

    const pricing = getModel(result.provider, result.model);
    if (!pricing || !pricing.supports_prompt_caching) continue;
    if (pricing.cache_read_input_cost_per_million === undefined) continue;

    const inputTokens = resolveInputTokens(result, pricing);
    const outputTokens = resolveOutputTokens(result, pricing);
    const standardCost = monthlyCostForModel(pricing, inputTokens, outputTokens, volume);
    const totalStandardCost = standardCost * locations.length;

    const cachedSavingsRatio =
      1 - pricing.cache_read_input_cost_per_million / pricing.input_cost_per_million;
    // Approximate: savings apply to the input portion across all shared sites
    const monthlySavings = totalStandardCost * cachedSavingsRatio * 0.5;

    if (monthlySavings <= 0) continue;

    findings.push({
      type: "caching",
      systemPrompt: truncatePrompt(prompt),
      locations: locations.map((l) => ({ file: l.file, line: l.line })),
      provider: result.provider,
      model: result.model,
      currentMonthlyCost: totalStandardCost,
      monthlySavings,
    });
  }

  return findings;
}

function truncatePrompt(prompt: string): string {
  const MAX_LEN = 60;
  if (prompt.length <= MAX_LEN) return prompt;
  return `${prompt.slice(0, MAX_LEN)}...`;
}

// ── Finding: batch API opportunities ────────────────────────────────

function detectBatchOpportunities(results: ScanResult[], volume: number): BatchFinding[] {
  // Group by file + model
  const groups = new Map<
    string,
    { file: string; model: string; provider: Provider; results: ScanResult[] }
  >();

  for (const result of results) {
    if (!result.model) continue;
    const key = `${result.filePath}::${result.model}`;
    const existing = groups.get(key);
    if (existing) {
      existing.results.push(result);
    } else {
      groups.set(key, {
        file: result.filePath,
        model: result.model,
        provider: result.provider,
        results: [result],
      });
    }
  }

  const findings: BatchFinding[] = [];

  for (const group of groups.values()) {
    if (group.results.length < 2) continue;

    const pricing = getModel(group.provider, group.model);
    if (!pricing) continue;
    if (pricing.batch_input_cost_per_million === undefined) continue;

    let totalStandardCost = 0;
    let totalBatchCost = 0;

    for (const result of group.results) {
      const inputTokens = resolveInputTokens(result, pricing);
      const outputTokens = resolveOutputTokens(result, pricing);
      const standard = calculateCost({
        model: pricing,
        inputTokens,
        outputTokens,
      });
      const batch = calculateCost({
        model: pricing,
        inputTokens,
        outputTokens,
        useBatch: true,
      });
      totalStandardCost += standard * volume * DAYS_PER_MONTH;
      totalBatchCost += batch * volume * DAYS_PER_MONTH;
    }

    const savings = totalStandardCost - totalBatchCost;
    if (savings <= 0) continue;

    findings.push({
      type: "batch",
      file: group.file,
      model: group.model,
      provider: group.provider,
      callCount: group.results.length,
      currentMonthlyCost: totalStandardCost,
      monthlySavings: savings,
    });
  }

  return findings;
}

// ── Formatting ──────────────────────────────────────────────────────

function formatDollars(usd: number): string {
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}

function formatFindingTable(finding: AuditFinding): string {
  const lines: string[] = [];

  switch (finding.type) {
    case "cheaper-model": {
      const loc = `${finding.file}:${finding.line}`;
      lines.push(
        `  ${chalk.cyan(loc)}  ${finding.currentModel} ${chalk.dim("→")} ${chalk.green(finding.suggestedModel)}`,
      );
      lines.push(
        `    Potential savings: ${chalk.green(`${formatDollars(finding.monthlySavings)}/mo`)}`,
      );
      break;
    }
    case "caching": {
      const promptDisplay = chalk.dim(`"${finding.systemPrompt}"`);
      const locList = finding.locations.map((l) => chalk.cyan(`${l.file}:${l.line}`)).join(", ");
      lines.push(
        `  System prompt ${promptDisplay} appears in ${finding.locations.length} call sites`,
      );
      lines.push(`    ${locList}`);
      lines.push(
        `    Enable prompt caching to save ~${chalk.green(`${formatDollars(finding.monthlySavings)}/mo`)} on input tokens`,
      );
      break;
    }
    case "batch": {
      lines.push(
        `  ${chalk.cyan(finding.file)} uses ${chalk.bold(finding.model)} across ${finding.callCount} call sites`,
      );
      lines.push(
        `    Batch API available — potential 50% cost reduction: ~${chalk.green(`${formatDollars(finding.monthlySavings)}/mo`)}`,
      );
      break;
    }
  }

  return lines.join("\n");
}

function formatAuditTable(summary: AuditSummary): string {
  if (summary.findings.length === 0) {
    return chalk.green("No optimization opportunities found. Your LLM usage looks efficient!");
  }

  const lines: string[] = [];
  lines.push(
    chalk.bold(
      `Inferwise Audit — ${summary.findings.length} optimization ${summary.findings.length === 1 ? "opportunity" : "opportunities"} found`,
    ),
  );
  lines.push("");

  const cheaper = summary.findings.filter((f) => f.type === "cheaper-model");
  const caching = summary.findings.filter((f) => f.type === "caching");
  const batch = summary.findings.filter((f) => f.type === "batch");

  if (cheaper.length > 0) {
    lines.push(chalk.bold.yellow("CHEAPER MODEL ALTERNATIVES"));
    for (const f of cheaper) lines.push(formatFindingTable(f));
    lines.push("");
  }

  if (caching.length > 0) {
    lines.push(chalk.bold.yellow("PROMPT CACHING OPPORTUNITIES"));
    for (const f of caching) lines.push(formatFindingTable(f));
    lines.push("");
  }

  if (batch.length > 0) {
    lines.push(chalk.bold.yellow("BATCH API OPPORTUNITIES"));
    for (const f of batch) lines.push(formatFindingTable(f));
    lines.push("");
  }

  lines.push(
    chalk.bold("Total potential savings: ") +
      chalk.bold.green(`${formatDollars(summary.totalSavings)}/mo`),
  );

  return lines.join("\n");
}

function formatAuditJson(summary: AuditSummary): string {
  return JSON.stringify(
    {
      totalPotentialSavings: summary.totalSavings,
      volume: summary.volume,
      findingsCount: summary.findings.length,
      findings: summary.findings,
    },
    null,
    2,
  );
}

function formatAuditMarkdown(summary: AuditSummary): string {
  const lines: string[] = [];
  lines.push("## Inferwise Audit Report");
  lines.push("");

  if (summary.findings.length === 0) {
    lines.push("No optimization opportunities found.");
    return lines.join("\n");
  }

  const count = summary.findings.length;
  lines.push(`**${count} optimization ${count === 1 ? "opportunity" : "opportunities"} found**`);
  lines.push("");

  const cheaper = summary.findings.filter((f) => f.type === "cheaper-model");
  const caching = summary.findings.filter((f) => f.type === "caching");
  const batch = summary.findings.filter((f) => f.type === "batch");

  if (cheaper.length > 0) {
    lines.push("### Cheaper Model Alternatives");
    lines.push("");
    lines.push("| Location | Current | Suggested | Savings |");
    lines.push("|----------|---------|-----------|---------|");
    for (const f of cheaper) {
      if (f.type !== "cheaper-model") continue;
      lines.push(
        `| \`${f.file}:${f.line}\` | ${f.currentModel} | ${f.suggestedModel} | ${formatDollars(f.monthlySavings)}/mo |`,
      );
    }
    lines.push("");
  }

  if (caching.length > 0) {
    lines.push("### Prompt Caching Opportunities");
    lines.push("");
    for (const f of caching) {
      if (f.type !== "caching") continue;
      const locs = f.locations.map((l) => `\`${l.file}:${l.line}\``).join(", ");
      lines.push(
        `- System prompt "${f.systemPrompt}" in ${f.locations.length} sites: ${locs} — save ~${formatDollars(f.monthlySavings)}/mo`,
      );
    }
    lines.push("");
  }

  if (batch.length > 0) {
    lines.push("### Batch API Opportunities");
    lines.push("");
    for (const f of batch) {
      if (f.type !== "batch") continue;
      lines.push(
        `- \`${f.file}\`: ${f.model} across ${f.callCount} calls — save ~${formatDollars(f.monthlySavings)}/mo`,
      );
    }
    lines.push("");
  }

  lines.push(`**Total potential savings: ${formatDollars(summary.totalSavings)}/mo**`);
  lines.push("");
  lines.push(
    `> Estimates based on ${summary.volume.toLocaleString()} requests/day. Configure with \`inferwise.config.json\`.`,
  );
  lines.push("> Powered by [Inferwise](https://inferwise.dev)");

  return lines.join("\n");
}

// ── Command ─────────────────────────────────────────────────────────

export function auditCommand(): Command {
  return new Command("audit")
    .description("Scan for cost optimization: cheaper models, caching, batch opportunities")
    .argument("[path]", "Path to scan", ".")
    .option("--volume <number>", "Requests per day for savings projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (scanPath: string, options: AuditOptions) => {
      const envVolume = getEnvVolume();
      const volume =
        options.volume !== "1000"
          ? Math.max(1, Number.parseInt(options.volume, 10) || 1000)
          : (envVolume ?? Math.max(1, Number.parseInt(options.volume, 10) || 1000));
      const format = resolveFormat(options.format);
      const config = await loadConfig(options.config);

      if (format === "table") {
        process.stderr.write(chalk.dim(`Scanning ${scanPath} for optimizations...\n`));
      }

      const results = await scanDirectory(scanPath, config.ignore);

      if (format === "table" && results.length === 0) {
        process.stdout.write(chalk.yellow("No LLM API calls detected.\n"));
        return;
      }

      const findings: AuditFinding[] = [
        ...detectCheaperModels(results, volume),
        ...detectCachingOpportunities(results, volume),
        ...detectBatchOpportunities(results, volume),
      ];

      const totalSavings = findings.reduce((sum, f) => sum + f.monthlySavings, 0);
      const summary: AuditSummary = { findings, totalSavings, volume };

      let output: string;
      if (format === "json") {
        output = formatAuditJson(summary);
      } else if (format === "markdown") {
        output = formatAuditMarkdown(summary);
      } else {
        output = formatAuditTable(summary);
      }

      process.stdout.write(`${output}\n`);
    });
}
