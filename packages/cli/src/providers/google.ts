import type { ProviderUsageResult } from "./types.js";

/**
 * Google does not provide a public per-model token usage API.
 * Returns empty result. Calibration will skip Google models.
 */
export async function fetchGoogleUsage(days: number): Promise<ProviderUsageResult | null> {
  const now = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    provider: "google",
    records: [],
    periodStart: start.toISOString(),
    periodEnd: now.toISOString(),
  };
}
