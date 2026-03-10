/**
 * Inferwise SDK — programmatic API for cost estimation and budget checking.
 *
 * Usage:
 *   import { estimateAndCheck, estimate } from "inferwise/sdk";
 *
 *   const result = await estimateAndCheck("./src", { maxMonthlyCost: 10000 });
 *   if (!result.ok) process.exit(1);
 */
import { loadCalibration } from "./calibration.js";
import { loadConfig } from "./config.js";
import type { InferwiseConfig } from "./config.js";
import { buildEstimateRows } from "./estimate-core.js";
import type { EstimateRow } from "./formatters/index.js";
import { scanDirectory } from "./scanners/index.js";

/** Options for estimate and check functions. */
export interface EstimateOptions {
  /** Requests per day for monthly cost projection. Default: 1000 */
  volume?: number;
  /** Path to inferwise.config.json. Auto-discovered if not set. */
  configPath?: string;
  /** Inline config object (takes precedence over configPath). */
  config?: InferwiseConfig;
  /** File patterns to ignore during scanning. */
  ignore?: string[];
}

/** Options for the budget check. */
export interface CheckOptions extends EstimateOptions {
  /** Max allowed total monthly cost (USD). Falls back to config budgets.block. */
  maxMonthlyCost?: number;
  /** Max allowed cost per single LLM call (USD). */
  maxCostPerCall?: number;
}

/** A single budget violation. */
export interface Violation {
  type: "monthly_total" | "per_call";
  message: string;
  file?: string;
  line?: number;
  actual: number;
  limit: number;
}

/** Result of an estimate scan. */
export interface EstimateResult {
  rows: EstimateRow[];
  totalMonthlyCost: number;
  volume: number;
  unknownModels: string[];
}

/** Result of a budget check. */
export interface CheckResult extends EstimateResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Scan a directory for LLM API calls and estimate costs.
 * Pure data — no console output, no process.exit.
 */
export async function estimate(
  scanPath: string,
  options?: EstimateOptions,
): Promise<EstimateResult> {
  const volume = options?.volume ?? 1000;
  const config = options?.config ?? (await loadConfig(options?.configPath));
  const calibration = await loadCalibration();
  const ignore = options?.ignore ?? config.ignore;

  const results = await scanDirectory(scanPath, ignore);
  const { rows, unknownModels } = buildEstimateRows(
    results,
    config,
    volume,
    false,
    null,
    calibration,
  );
  const totalMonthlyCost = rows.reduce((sum, r) => sum + r.monthlyCost, 0);

  return {
    rows,
    totalMonthlyCost,
    volume,
    unknownModels: [...unknownModels],
  };
}

/**
 * Scan a directory and check costs against budget thresholds.
 * Returns { ok: true } if within budget, { ok: false, violations } if not.
 * Pure data — no console output, no process.exit.
 */
export async function estimateAndCheck(
  scanPath: string,
  options?: CheckOptions,
): Promise<CheckResult> {
  const result = await estimate(scanPath, options);
  const config = options?.config ?? (await loadConfig(options?.configPath));

  const maxMonthlyCost = options?.maxMonthlyCost ?? config.budgets?.block;
  const maxCostPerCall = options?.maxCostPerCall;

  const violations: Violation[] = [];

  if (maxMonthlyCost !== undefined && result.totalMonthlyCost > maxMonthlyCost) {
    violations.push({
      type: "monthly_total",
      message: `Total monthly cost $${result.totalMonthlyCost.toFixed(2)} exceeds limit $${maxMonthlyCost.toFixed(2)}/mo`,
      actual: result.totalMonthlyCost,
      limit: maxMonthlyCost,
    });
  }

  if (maxCostPerCall !== undefined) {
    for (const row of result.rows) {
      if (row.costPerCall > maxCostPerCall) {
        violations.push({
          type: "per_call",
          message: `${row.file}:${row.line} — ${row.model} costs $${row.costPerCall.toFixed(4)}/call (limit: $${maxCostPerCall.toFixed(4)})`,
          file: row.file,
          line: row.line,
          actual: row.costPerCall,
          limit: maxCostPerCall,
        });
      }
    }
  }

  return {
    ...result,
    ok: violations.length === 0,
    violations,
  };
}
