import type { Provider } from "@inferwise/pricing-db";

export interface ProviderUsageRecord {
  model: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

export interface ProviderUsageResult {
  provider: Provider;
  records: ProviderUsageRecord[];
  periodStart: string;
  periodEnd: string;
}
