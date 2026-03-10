import chalk from "chalk";
import Table from "cli-table3";

export type OutputFormat = "table" | "json" | "markdown";

/** How token counts were determined. */
export type TokenSource =
  | "code" // Extracted from code — exact value
  | "model_limit" // Derived from model spec — worst-case ceiling
  | "production" // Averaged from production usage data
  | "calibrated"; // Adjusted by calibration data from provider APIs

export interface EstimateRow {
  file: string;
  line: number;
  provider: string;
  model: string;
  inputTokens: number;
  inputTokenSource: TokenSource;
  outputTokens: number;
  outputTokenSource: TokenSource;
  costPerCall: number;
  monthlyCost: number;
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

function formatTokenCount(tokens: number, source: TokenSource): string {
  const count = tokens.toLocaleString();
  if (source === "model_limit") {
    return chalk.yellow(`${count} *`);
  }
  if (source === "production") {
    return chalk.cyan(`${count} †`);
  }
  if (source === "calibrated") {
    return chalk.magenta(`${count} ~`);
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
    table.push([
      chalk.cyan(row.file),
      String(row.line),
      row.provider,
      row.model,
      formatTokenCount(row.inputTokens, row.inputTokenSource),
      formatTokenCount(row.outputTokens, row.outputTokenSource),
      formatCost(row.costPerCall),
      formatMonthlyCost(row.monthlyCost),
    ]);
  }

  const lines: string[] = [table.toString()];

  const totalLine =
    chalk.bold("Total monthly cost: ") +
    chalk.bold(chalk.green(formatMonthlyCost(summary.totalMonthlyCost)));
  lines.push(totalLine);

  const hasModelLimit = summary.rows.some(
    (r) => r.inputTokenSource === "model_limit" || r.outputTokenSource === "model_limit",
  );
  if (hasModelLimit) {
    lines.push(
      chalk.dim(
        "* Worst-case ceiling from model spec. Set max_tokens and use static prompts for exact cost.",
      ),
    );
  }

  const hasProduction = summary.rows.some(
    (r) => r.inputTokenSource === "production" || r.outputTokenSource === "production",
  );
  if (hasProduction) {
    lines.push(chalk.dim("† Averaged from production usage data via Inferwise Cloud."));
  }

  const hasCalibrated = summary.rows.some(
    (r) => r.inputTokenSource === "calibrated" || r.outputTokenSource === "calibrated",
  );
  if (hasCalibrated) {
    lines.push(chalk.dim("~ Adjusted by calibration data. Run inferwise calibrate to update."));
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
    const inputSuffix =
      row.inputTokenSource === "model_limit"
        ? " \\*"
        : row.inputTokenSource === "production"
          ? " †"
          : row.inputTokenSource === "calibrated"
            ? " ~"
            : "";
    const outputSuffix =
      row.outputTokenSource === "model_limit"
        ? " \\*"
        : row.outputTokenSource === "production"
          ? " †"
          : row.outputTokenSource === "calibrated"
            ? " ~"
            : "";
    lines.push(
      `| \`${row.file}\` | ${row.line} | ${row.provider} | ${row.model} | ${row.inputTokens.toLocaleString()}${inputSuffix} | ${row.outputTokens.toLocaleString()}${outputSuffix} | ${formatCost(row.costPerCall)} | ${formatMonthlyCost(row.monthlyCost)} |`,
    );
  }

  lines.push("");
  lines.push(`**Total monthly cost: ${formatMonthlyCost(summary.totalMonthlyCost)}**`);

  const hasModelLimit = summary.rows.some(
    (r) => r.inputTokenSource === "model_limit" || r.outputTokenSource === "model_limit",
  );
  if (hasModelLimit) {
    lines.push("");
    lines.push(
      "> \\* Worst-case ceiling from model spec. Set `max_tokens` and use static prompts for exact cost.",
    );
  }

  const hasProduction = summary.rows.some(
    (r) => r.inputTokenSource === "production" || r.outputTokenSource === "production",
  );
  if (hasProduction) {
    lines.push("");
    lines.push("> † Averaged from production usage data via Inferwise Cloud.");
  }

  const hasCalibrated = summary.rows.some(
    (r) => r.inputTokenSource === "calibrated" || r.outputTokenSource === "calibrated",
  );
  if (hasCalibrated) {
    lines.push("");
    lines.push("> ~ Adjusted by calibration data. Run `inferwise calibrate` to update.");
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
