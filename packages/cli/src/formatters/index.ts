import chalk from "chalk";
import Table from "cli-table3";

export type OutputFormat = "table" | "json" | "markdown";

/** How output tokens were determined. */
export type OutputTokenSource =
  | "max_tokens" // Extracted from code — exact
  | "model_limit" // Model's max_output_tokens — worst-case ceiling
  | "unavailable"; // Cannot determine — no model or max_tokens found

export interface EstimateRow {
  file: string;
  line: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  outputTokenSource: OutputTokenSource;
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

function formatOutputTokens(row: EstimateRow): string {
  if (row.outputTokenSource === "unavailable") {
    return chalk.red("? **");
  }
  const count = row.outputTokens.toLocaleString();
  if (row.outputTokenSource === "model_limit") {
    return chalk.yellow(`${count} *`);
  }
  return count;
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

    const outputDisplay = formatOutputTokens(row);

    table.push([
      chalk.cyan(row.file),
      String(row.line),
      row.provider,
      modelDisplay,
      row.inputTokens.toLocaleString(),
      outputDisplay,
      formatCost(row.costPerCall),
      formatMonthlyCost(row.monthlyCost),
    ]);
  }

  const lines: string[] = [table.toString()];

  const totalLine =
    chalk.bold("Total monthly cost: ") +
    chalk.bold(chalk.green(formatMonthlyCost(summary.totalMonthlyCost)));
  lines.push(totalLine);

  const legends: string[] = [];
  if (summary.rows.some((r) => r.isDynamic)) {
    legends.push("~ Dynamic prompt — input tokens unknown, showing output cost only.");
  }
  if (summary.rows.some((r) => r.outputTokenSource === "model_limit")) {
    legends.push(
      "* No max_tokens in code — using model's max_output_tokens (worst case). Set max_tokens for exact cost.",
    );
  }
  if (summary.rows.some((r) => r.outputTokenSource === "unavailable")) {
    legends.push(
      "** Unknown model and no max_tokens — cannot calculate output cost. Set max_tokens in code.",
    );
  }
  for (const legend of legends) {
    lines.push(chalk.dim(legend));
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
  lines.push(
    "|------|------|----------|-------|-------------|--------------|-----------|---------|",
  );

  for (const row of summary.rows) {
    const modelDisplay = row.isDynamic ? `${row.model ?? "unknown"} ~` : (row.model ?? "unknown");
    const outputSuffix =
      row.outputTokenSource === "model_limit"
        ? " *"
        : row.outputTokenSource === "unavailable"
          ? " **"
          : "";
    lines.push(
      `| \`${row.file}\` | ${row.line} | ${row.provider} | ${modelDisplay} | ${row.inputTokens.toLocaleString()} | ${row.outputTokens.toLocaleString()}${outputSuffix} | ${formatCost(row.costPerCall)} | ${formatMonthlyCost(row.monthlyCost)} |`,
    );
  }

  lines.push("");
  lines.push(`**Total monthly cost: ${formatMonthlyCost(summary.totalMonthlyCost)}**`);

  const notes: string[] = [];
  if (summary.rows.some((r) => r.isDynamic)) {
    notes.push("~ Dynamic prompt — input tokens unknown, showing output cost only.");
  }
  if (summary.rows.some((r) => r.outputTokenSource === "model_limit")) {
    notes.push(
      "\\* No `max_tokens` in code — using model's `max_output_tokens` (worst case). Set `max_tokens` for exact cost.",
    );
  }
  if (summary.rows.some((r) => r.outputTokenSource === "unavailable")) {
    notes.push(
      "\\*\\* Unknown model and no `max_tokens` — cannot calculate output cost. Set `max_tokens` in code.",
    );
  }
  if (notes.length > 0) {
    lines.push("");
    for (const note of notes) {
      lines.push(`> ${note}`);
    }
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
