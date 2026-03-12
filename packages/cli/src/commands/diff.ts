import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import Table from "cli-table3";
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { loadCalibration } from "../calibration.js";
import type { InferwiseConfig } from "../config.js";
import { getEnvVolume, loadConfig, parseVolume } from "../config.js";
import { buildEstimateRows } from "../estimate-core.js";
import { scanDirectory } from "../scanners/index.js";

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

export interface FileCost {
  file: string;
  model: string;
  provider: string;
  monthlyCost: number;
  costPerCall: number;
}

export interface DiffRow {
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

  // Verify the ref exists before proceeding
  try {
    await git.raw(["rev-parse", "--verify", ref]);
  } catch {
    throw new Error(`Git ref '${ref}' not found. Run 'git branch -a' to see available refs.`);
  }

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

/** Aggregate per-file costs from a scan directory using shared estimation logic. */
async function getFileCosts(
  dirPath: string,
  config: InferwiseConfig,
  cliVolume: number,
  cliVolumeExplicit: boolean,
  calibration: Awaited<ReturnType<typeof loadCalibration>>,
): Promise<Map<string, FileCost[]>> {
  const results = await scanDirectory(dirPath, config.ignore);
  const { rows } = buildEstimateRows(
    results,
    config,
    cliVolume,
    cliVolumeExplicit,
    null,
    calibration,
  );

  const byFile = new Map<string, FileCost[]>();
  for (const row of rows) {
    const entry: FileCost = {
      file: row.file,
      model: row.model,
      provider: row.provider,
      costPerCall: row.costPerCall,
      monthlyCost: row.monthlyCost,
    };
    const existing = byFile.get(row.file) ?? [];
    existing.push(entry);
    byFile.set(row.file, existing);
  }

  return byFile;
}

/** Determine the change type between base and head models. */
export function classifyChange(
  baseModel: string | null,
  headModel: string | null,
): DiffRow["change"] {
  if (!baseModel && headModel) return "added";
  if (baseModel && !headModel) return "removed";
  if (baseModel === headModel) return "unchanged";

  // Both exist but differ — could be upgrade or downgrade based on cost,
  // but we don't know cost direction from model name alone. Use "modified".
  return "modified";
}

/**
 * Build diff rows per call site, not per file.
 * Matches base and head call sites by model within each file,
 * so model changes (e.g., Opus → Sonnet) surface as separate rows.
 */
export function buildDiff(
  baseCosts: Map<string, FileCost[]>,
  headCosts: Map<string, FileCost[]>,
): DiffRow[] {
  const allFiles = new Set([...baseCosts.keys(), ...headCosts.keys()]);
  const rows: DiffRow[] = [];

  for (const file of allFiles) {
    const base = [...(baseCosts.get(file) ?? [])];
    const head = [...(headCosts.get(file) ?? [])];

    // Match call sites by model — pair identical models first
    const matchedBase = new Set<number>();
    const matchedHead = new Set<number>();

    for (let h = 0; h < head.length; h++) {
      for (let b = 0; b < base.length; b++) {
        if (matchedBase.has(b)) continue;
        if (head[h]?.model === base[b]?.model) {
          matchedBase.add(b);
          matchedHead.add(h);
          // Same model, check for cost change (e.g., pricing update)
          const delta = (head[h]?.monthlyCost ?? 0) - (base[b]?.monthlyCost ?? 0);
          if (delta !== 0) {
            rows.push({
              file,
              baseModel: base[b]?.model ?? null,
              headModel: head[h]?.model ?? null,
              change: "unchanged",
              baseMonthlyCost: base[b]?.monthlyCost ?? 0,
              headMonthlyCost: head[h]?.monthlyCost ?? 0,
              monthlyDelta: delta,
            });
          }
          break;
        }
      }
    }

    // Unmatched base entries = removed or changed call sites
    const unmatchedBase = base.filter((_, i) => !matchedBase.has(i));
    // Unmatched head entries = added or changed call sites
    const unmatchedHead = head.filter((_, i) => !matchedHead.has(i));

    // Pair remaining by position (model changed at same call site)
    const pairCount = Math.min(unmatchedBase.length, unmatchedHead.length);
    for (let i = 0; i < pairCount; i++) {
      const b = unmatchedBase[i];
      const h = unmatchedHead[i];
      if (!b || !h) continue;
      rows.push({
        file,
        baseModel: b.model,
        headModel: h.model,
        change: classifyChange(b.model, h.model),
        baseMonthlyCost: b.monthlyCost,
        headMonthlyCost: h.monthlyCost,
        monthlyDelta: h.monthlyCost - b.monthlyCost,
      });
    }

    // Remaining unmatched base = purely removed
    for (let i = pairCount; i < unmatchedBase.length; i++) {
      const b = unmatchedBase[i];
      if (!b) continue;
      rows.push({
        file,
        baseModel: b.model,
        headModel: null,
        change: "removed",
        baseMonthlyCost: b.monthlyCost,
        headMonthlyCost: 0,
        monthlyDelta: -b.monthlyCost,
      });
    }

    // Remaining unmatched head = purely added
    for (let i = pairCount; i < unmatchedHead.length; i++) {
      const h = unmatchedHead[i];
      if (!h) continue;
      rows.push({
        file,
        baseModel: null,
        headModel: h.model,
        change: "added",
        baseMonthlyCost: 0,
        headMonthlyCost: h.monthlyCost,
        monthlyDelta: h.monthlyCost,
      });
    }
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
  if (raw !== "table") {
    process.stderr.write(`Warning: Unknown format "${raw}" — using table.\n`);
  }
  return "table";
}

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare token costs between two git refs")
    .argument("[path]", "Path to git repository", ".")
    .option("--base <ref>", "Base git ref", "main")
    .option("--head <ref>", "Head git ref", "HEAD")
    .option("--volume <number>", "Requests per day for monthly projection", "1000")
    .option("--format <table|json|markdown>", "Output format", "table")
    .option("--fail-on-increase <amount>", "Exit 1 if monthly increase exceeds this USD amount")
    .option("--config <path>", "Path to inferwise.config.json")
    .action(async (scanPath: string, options: DiffOptions) => {
      const envVolume = getEnvVolume();
      const cliVolumeExplicit = options.volume !== "1000";
      const cliVolume = cliVolumeExplicit
        ? parseVolume(options.volume, 1000)
        : (envVolume ?? parseVolume(options.volume, 1000));
      const format = resolveFormat(options.format);
      const base = options.base;
      const head = options.head;

      const config = await loadConfig(options.config);

      // Load calibration data if available (same as estimate command)
      const calibration = await loadCalibration();

      if (format === "table") {
        process.stderr.write(chalk.dim(`Comparing ${base} → ${head}...\n`));
      }

      const gitRoot = path.resolve(scanPath);

      // Verify this is a git repository
      try {
        const git = simpleGit(gitRoot);
        await git.raw(["rev-parse", "--git-dir"]);
      } catch {
        process.stderr.write(chalk.red(`Error: '${scanPath}' is not inside a git repository.\n`));
        process.exit(1);
      }

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
            getFileCosts(baseDir, config, cliVolume, cliVolumeExplicit, calibration),
            getFileCosts(gitRoot, config, cliVolume, cliVolumeExplicit, calibration),
          ]);
        } else {
          if (format === "table") process.stderr.write(chalk.dim(`Checking out ${head}...\n`));
          headDir = await checkoutRefToDir(gitRoot, head);
          [baseCosts, headCosts] = await Promise.all([
            getFileCosts(baseDir, config, cliVolume, cliVolumeExplicit, calibration),
            getFileCosts(headDir, config, cliVolume, cliVolumeExplicit, calibration),
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

        // Budget enforcement from config
        if (netMonthlyDelta > 0 && config.budgets) {
          const b = config.budgets;
          if (b.warn !== undefined && netMonthlyDelta >= b.warn) {
            process.stderr.write(
              chalk.yellow(
                `Budget warning: +$${netMonthlyDelta.toFixed(2)}/mo exceeds warn threshold ($${b.warn}/mo).\n`,
              ),
            );
          }
          if (b.block !== undefined && netMonthlyDelta >= b.block) {
            process.stderr.write(
              chalk.red(
                `Budget exceeded: +$${netMonthlyDelta.toFixed(2)}/mo exceeds block threshold ($${b.block}/mo). Exiting with code 1.\n`,
              ),
            );
            process.exit(1);
          }
        }

        // Legacy: --fail-on-increase flag (overridden by budgets.block if both set)
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
