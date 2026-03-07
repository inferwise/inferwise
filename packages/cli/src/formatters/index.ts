import Table from "cli-table3";
import chalk from "chalk";

export type OutputFormat = "table" | "json" | "markdown";

export interface EstimateRow {
  file: string;
  line: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costPerCall: number;
  monthlyCost: number;
  isDynamic: boolean;
}

export interface EstimateSummary {
  rows: EstimateRow[];
  totalMonthlyCost: number;
  volume: number;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.000000";
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatMonthlyCost(usd: number): string {
  if (usd < 1) return `$${usd.toFixed(4)}/mo`;
  if (usd < 100) return `$${usd.toFixed(2)}/mo`;
  return `$${Math.round(usd).toLocaleString()}/mo`;
}

export function formatTable(summary: EstimateSummary): string {
  if (summary.rows.length === 0) {
    return chalk.yellow("No LLM API calls detected.");
  }

  const table = new Table({
    head: [
      chalk.bold("File"),
      chalk.bold("Line"),
      chalk.bold("Provider"),
      chalk.bold("Model"),
      chalk.bold("Input Tokens"),
      chalk.bold("Output Tokens"),
      chalk.bold("Cost/Call"),
      chalk.bold(`Monthly (${summary.volume.toLocaleString()}/day)`),
    ],
    style: { head: [], border: [] },
    colAligns: ["left", "right", "left", "left", "right", "right", "right", "right"],
  });

  for (const row of summary.rows) {
    const modelDisplay = row.isDynamic
      ? chalk.dim(`${row.model ?? "unknown"} ~`)
      : (row.model ?? "unknown");

    table.push([
      chalk.cyan(row.file),
      String(row.line),
      row.provider,
      modelDisplay,
      row.inputTokens.toLocaleString(),
      row.outputTokens.toLocaleString(),
      formatCost(row.costPerCall),
      formatMonthlyCost(row.monthlyCost),
    ]);
  }

  const lines: string[] = [table.toString()];

  const totalLine =
    chalk.bold("Total monthly cost: ") +
    chalk.bold(chalk.green(formatMonthlyCost(summary.totalMonthlyCost)));
  lines.push(totalLine);

  if (summary.rows.some((r) => r.isDynamic)) {
    lines.push(chalk.dim("~ Dynamic prompts — token counts are estimates based on defaults."));
  }

  return lines.join("\n");
}

export function formatMarkdown(summary: EstimateSummary): string {
  const lines: string[] = [];

  lines.push("## Inferwise Cost Report");
  lines.push("");

  if (summary.rows.length === 0) {
    lines.push("No LLM API calls detected.");
    return lines.join("\n");
  }

  lines.push(
    `| File | Line | Provider | Model | Input Tokens | Output Tokens | Cost/Call | Monthly (${summary.volume.toLocaleString()}/day) |`,
  );
  lines.push("|------|------|----------|-------|-------------|--------------|-----------|---------|");

  for (const row of summary.rows) {
    const modelDisplay = row.isDynamic ? `${row.model ?? "unknown"} ~` : (row.model ?? "unknown");
    lines.push(
      `| \`${row.file}\` | ${row.line} | ${row.provider} | ${modelDisplay} | ${row.inputTokens.toLocaleString()} | ${row.outputTokens.toLocaleString()} | ${formatCost(row.costPerCall)} | ${formatMonthlyCost(row.monthlyCost)} |`,
    );
  }

  lines.push("");
  lines.push(`**Total monthly cost: ${formatMonthlyCost(summary.totalMonthlyCost)}**`);

  if (summary.rows.some((r) => r.isDynamic)) {
    lines.push("");
    lines.push(
      "> ~ Dynamic prompts — token counts are estimates based on defaults. Provide static prompts or use `--precise` for exact counts.",
    );
  }

  lines.push("");
  lines.push(
    `> Estimates based on ${summary.volume.toLocaleString()} requests/day. Configure with \`inferwise.config.json\`.`,
  );
  lines.push("> Powered by [Inferwise](https://inferwise.dev)");

  return lines.join("\n");
}

export function formatJson(summary: EstimateSummary): string {
  return JSON.stringify(
    {
      totalMonthlyCost: summary.totalMonthlyCost,
      volume: summary.volume,
      callSites: summary.rows,
    },
    null,
    2,
  );
}
