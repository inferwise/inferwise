import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import type { InferwiseConfig } from "../config.js";
import { loadConfig, resolveVolume } from "../config.js";
import { scanDirectory } from "../scanners/index.js";
import { countMessageTokens } from "../tokenizers/index.js";

const SUPPORTED_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"]);

interface DiffOptions {
  base: string;
  head: string;
  volume: string;
  format: string;
  failOnIncrease?: string;
  config?: string;
}

export type DiffOutputFormat = "table" | "json" | "markdown";

interface FileCost {
  file: string;
  model: string;
  provider: string;
  monthlyCost: number;
  costPerCall: number;
}

interface DiffRow {
  file: string;
  baseModel: string | null;
  headModel: string | null;
  change: "added" | "removed" | "upgraded" | "downgraded" | "unchanged" | "modified";
  baseMonthlyCost: number;
  headMonthlyCost: number;
  monthlyDelta: number;
}

interface DiffSummary {
  rows: DiffRow[];
  netMonthlyDelta: number;
  volume: number;
}

/** Checkout all supported source files from a git ref into a temp directory. */
async function checkoutRefToDir(gitRoot: string, ref: string): Promise<string> {
  const git = simpleGit(gitRoot);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "inferwise-diff-"));

  const lsResult = await git.raw(["ls-tree", "-r", "--name-only", ref]);
  const files = lsResult
    .trim()
    .split("\n")
    .filter((f) => {
      if (!f) return false;
      const ext = f.split(".").pop() ?? "";
      return SUPPORTED_EXTENSIONS.has(ext);
    });

  await Promise.all(
    files.map(async (file) => {
      try {
        const content = await git.show([`${ref}:${file}`]);
        const destPath = path.join(tmpDir, file);
        await mkdir(path.dirname(destPath), { recursive: true });
        await writeFile(destPath, content, "utf-8");
      } catch {
        // File may not exist at this ref — skip silently
      }
    }),
  );

  return tmpDir;
}

/** Use cheapest current model for a provider when model ID is unknown. */
function fallbackModel(provider: Provider): ModelPricing | undefined {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return undefined;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}

/** Compute cost for a single scan result. */
function computeFileCostEntry(
  result: {
    filePath: string;
    provider: Provider;
    model: string | null;
    systemPrompt: string | null;
    userPrompt: string | null;
    maxOutputTokens?: number | null;
  },
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
): FileCost {
  const provider = result.provider;
  const modelId = result.model;
  const volume = resolveVolume(config, result.filePath, cliVolume, cliVolumeExplicit);

  const pricing = modelId ? getModel(provider, modelId) : fallbackModel(provider);

  let inputTokens = 0;
  if (result.systemPrompt || result.userPrompt) {
    inputTokens = countMessageTokens(provider, modelId ?? "", {
      ...(result.systemPrompt ? { system: result.systemPrompt } : {}),
      ...(result.userPrompt ? { user: result.userPrompt } : {}),
    });
  } else if (pricing) {
    inputTokens = pricing.context_window - pricing.max_output_tokens;
  }

  let outputTokens = 0;
  if (result.maxOutputTokens) {
    outputTokens = result.maxOutputTokens;
  } else if (pricing) {
    outputTokens = pricing.max_output_tokens;
  }

  const costPerCall = pricing ? calculateCost({ model: pricing, inputTokens, outputTokens }) : 0;
  const monthlyCost = costPerCall * volume * 30;

  return {
    file: result.filePath,
    model: modelId ?? "unknown",
    provider,
    costPerCall,
    monthlyCost,
  };
}

/** Aggregate per-file costs from a scan directory. */
async function getFileCosts(
  dirPath: string,
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
): Promise<Map<string, FileCost[]>> {
  const results = await scanDirectory(dirPath, config.ignore);
  const byFile = new Map<string, FileCost[]>();

  for (const result of results) {
    const entry = computeFileCostEntry(
      { ...result, provider: result.provider as Provider },
      config,
      cliVolume,
      cliVolumeExplicit,
    );

    const existing = byFile.get(result.filePath) ?? [];
    existing.push(entry);
    byFile.set(result.filePath, existing);
  }

  return byFile;
}

/** Determine the change type between base and head models. */
function classifyChange(baseModel: string | null, headModel: string | null): DiffRow["change"] {
  if (!baseModel && headModel) return "added";
  if (baseModel && !headModel) return "removed";
  if (baseModel === headModel) return "unchanged";

  // Both exist but differ — could be upgrade or downgrade based on cost,
  // but we don't know cost direction from model name alone. Use "modified".
  return "modified";
}

function sumMonthlyCost(costs: FileCost[]): number {
  return costs.reduce((sum, c) => sum + c.monthlyCost, 0);
}

function primaryModel(costs: FileCost[]): string | null {
  if (costs.length === 0) return null;
  // Return the most expensive model's ID as the representative
  return costs.reduce((a, b) => (a.monthlyCost >= b.monthlyCost ? a : b)).model;
}

function buildDiff(
  baseCosts: Map<string, FileCost[]>,
  headCosts: Map<string, FileCost[]>,
): DiffRow[] {
  const allFiles = new Set([...baseCosts.keys(), ...headCosts.keys()]);
  const rows: DiffRow[] = [];

  for (const file of allFiles) {
    const base = baseCosts.get(file) ?? [];
    const head = headCosts.get(file) ?? [];

    const baseMonthlyCost = sumMonthlyCost(base);
    const headMonthlyCost = sumMonthlyCost(head);
    const monthlyDelta = headMonthlyCost - baseMonthlyCost;

    const baseModel = primaryModel(base);
    const headModel = primaryModel(head);

    // Skip files with no cost change and same model
    if (monthlyDelta === 0 && baseModel === headModel) continue;

    const change = classifyChange(baseModel, headModel);

    rows.push({
      file,
      baseModel,
      headModel,
      change,
      baseMonthlyCost,
      headMonthlyCost,
      monthlyDelta,
    });
  }

  rows.sort((a, b) => Math.abs(b.monthlyDelta) - Math.abs(a.monthlyDelta));
  return rows;
}

function formatCostDelta(delta: number): string {
  const abs = Math.abs(delta);
  const formatted =
    abs < 1
      ? `$${abs.toFixed(4)}`
      : abs < 100
        ? `$${abs.toFixed(2)}`
        : `$${Math.round(abs).toLocaleString()}`;
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${formatted}/mo`;
}

function changeLabel(row: DiffRow): string {
  switch (row.change) {
    case "added":
      return chalk.green("Added");
    case "removed":
      return chalk.red("Removed");
    case "upgraded":
      return chalk.yellow("Upgraded");
    case "downgraded":
      return chalk.green("Downgraded");
    case "modified":
      return chalk.yellow("Modified");
    case "unchanged":
      return "Unchanged";
  }
}

function modelLabel(row: DiffRow): string {
  if (row.change === "added") return `(new) ${row.headModel ?? "unknown"}`;
  if (row.change === "removed") return `(removed) ${row.baseModel ?? "unknown"}`;
  if (row.baseModel === row.headModel) return row.headModel ?? "unknown";
  return `${row.baseModel ?? "unknown"} → ${row.headModel ?? "unknown"}`;
}

function formatDiffTable(summary: DiffSummary): string {
  if (summary.rows.length === 0) {
    return chalk.dim("No cost changes detected between refs.");
  }

  const table = new Table({
    head: [
      chalk.bold("File"),
      chalk.bold("Model"),
      chalk.bold("Change"),
      chalk.bold("Cost/Call"),
      chalk.bold(`Monthly Impact (${summary.volume.toLocaleString()}/day)`),
    ],
    style: { head: [], border: [] },
    colAligns: ["left", "left", "left", "right", "right"],
  });

  for (const row of summary.rows) {
    const deltaStr = formatCostDelta(row.monthlyDelta);
    const deltaColored = row.monthlyDelta > 0 ? chalk.red(deltaStr) : chalk.green(deltaStr);

    table.push([
      chalk.cyan(row.file),
      modelLabel(row),
      changeLabel(row),
      // Cost/call not tracked at diff level — show delta context instead
      row.change === "added"
        ? chalk.green(`+$${(row.headMonthlyCost / (summary.volume * 30)).toFixed(6)}`)
        : row.change === "removed"
          ? chalk.red(`-$${(row.baseMonthlyCost / (summary.volume * 30)).toFixed(6)}`)
          : "—",
      deltaColored,
    ]);
  }

  const lines = [table.toString()];

  const netStr = formatCostDelta(summary.netMonthlyDelta);
  const netColored = summary.netMonthlyDelta > 0 ? chalk.red(netStr) : chalk.green(netStr);
  lines.push(chalk.bold("Net monthly impact: ") + chalk.bold(netColored));

  return lines.join("\n");
}

function formatDiffMarkdown(summary: DiffSummary, base: string, head: string): string {
  const lines: string[] = [];
  lines.push("## Inferwise Cost Report");
  lines.push("");

  if (summary.rows.length === 0) {
    lines.push("No cost changes detected between refs.");
    return lines.join("\n");
  }

  lines.push("| File | Model | Change | Cost/Call | Monthly Impact |");
  lines.push("|------|-------|--------|-----------|----------------|");

  for (const row of summary.rows) {
    const delta = formatCostDelta(row.monthlyDelta).replace("/mo", "/mo");
    const costPerCall =
      row.change === "added"
        ? `+$${(row.headMonthlyCost / (summary.volume * 30)).toFixed(6)}`
        : row.change === "removed"
          ? `-$${(row.baseMonthlyCost / (summary.volume * 30)).toFixed(6)}`
          : "—";

    lines.push(
      `| \`${row.file}\` | ${modelLabel(row)} | ${row.change} | ${costPerCall} | ${delta} |`,
    );
  }

  lines.push("");
  lines.push(`**Net monthly impact: ${formatCostDelta(summary.netMonthlyDelta)}**`);
  lines.push("");
  lines.push(
    `> Estimates based on ${summary.volume.toLocaleString()} requests/day. Comparing \`${base}\` → \`${head}\`.`,
  );
  lines.push("> Configure with `inferwise.config.json`.");
  lines.push("> Powered by [Inferwise](https://inferwise.dev)");

  return lines.join("\n");
}

function formatDiffJson(summary: DiffSummary): string {
  return JSON.stringify(
    {
      netMonthlyDelta: summary.netMonthlyDelta,
      volume: summary.volume,
      changes: summary.rows,
    },
    null,
    2,
  );
}

function resolveFormat(raw: string): DiffOutputFormat {
  if (raw === "json" || raw === "markdown") return raw;
  return "table";
}

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare token costs between two git refs")
    .option("--base <ref>", "Base git ref", "main")
    .option("--head <ref>", "Head git ref", "HEAD")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--fail-on-increase <amount>", "Exit 1 if monthly increase exceeds this USD amount")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (options: DiffOptions) => {
      const cliVolume = Math.max(1, Number.parseInt(options.volume, 10) || 1000);
      const cliVolumeExplicit = options.volume !== "1000";
      const format = resolveFormat(options.format);
      const base = options.base;
      const head = options.head;

      const config = await loadConfig(options.config);

      if (format === "table") {
        process.stderr.write(chalk.dim(`Comparing ${base} → ${head}...\n`));
      }

      const gitRoot = process.cwd();
      let baseDir: string | null = null;
      let headDir: string | null = null;

      try {
        if (format === "table") process.stderr.write(chalk.dim(`Checking out ${base}...\n`));
        baseDir = await checkoutRefToDir(gitRoot, base);

        let baseCosts: Map<string, FileCost[]>;
        let headCosts: Map<string, FileCost[]>;

        // Head: use working directory if HEAD (captures uncommitted changes)
        if (head === "HEAD") {
          if (format === "table")
            process.stderr.write(chalk.dim("Scanning working directory...\n"));
          [baseCosts, headCosts] = await Promise.all([
            getFileCosts(baseDir, config, cliVolume, cliVolumeExplicit),
            getFileCosts(gitRoot, config, cliVolume, cliVolumeExplicit),
          ]);
        } else {
          if (format === "table") process.stderr.write(chalk.dim(`Checking out ${head}...\n`));
          headDir = await checkoutRefToDir(gitRoot, head);
          [baseCosts, headCosts] = await Promise.all([
            getFileCosts(baseDir, config, cliVolume, cliVolumeExplicit),
            getFileCosts(headDir, config, cliVolume, cliVolumeExplicit),
          ]);
        }

        const rows = buildDiff(baseCosts, headCosts);
        const netMonthlyDelta = rows.reduce((sum, r) => sum + r.monthlyDelta, 0);
        const summary: DiffSummary = { rows, netMonthlyDelta, volume: cliVolume };

        let output: string;
        if (format === "json") {
          output = formatDiffJson(summary);
        } else if (format === "markdown") {
          output = formatDiffMarkdown(summary, base, head);
        } else {
          output = formatDiffTable(summary);
        }

        process.stdout.write(`${output}\n`);

        if (options.failOnIncrease !== undefined) {
          const threshold = Number.parseFloat(options.failOnIncrease);
          if (!Number.isNaN(threshold) && netMonthlyDelta > threshold) {
            process.stderr.write(
              chalk.red(
                `Monthly cost increase $${netMonthlyDelta.toFixed(2)} exceeds threshold $${threshold.toFixed(2)}. Exiting with code 1.\n`,
              ),
            );
            process.exit(1);
          }
        }
      } finally {
        await Promise.all(
          [baseDir, headDir]
            .filter((d): d is string => d !== null)
            .map((d) => rm(d, { recursive: true, force: true }).catch(() => {})),
        );
      }
    });
}
