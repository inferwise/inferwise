import type { ProviderUsageResult } from "./types.js";

/**
 * xAI does not provide a public per-model token usage API.
 * Returns empty result. Calibration will skip xAI models.
 */
export async function fetchXaiUsage(days: number): Promise<ProviderUsageResult | null> {
  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    provider: "xai",
    records: [],
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
  };
}
