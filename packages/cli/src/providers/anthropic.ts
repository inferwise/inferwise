import type { ProviderUsageRecord, ProviderUsageResult } from "./types.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ENV_KEY = "ANTHROPIC_ADMIN_API_KEY";

interface UsageBucket {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  num_requests?: number;
  model?: string;
}

interface UsageResponse {
  data: UsageBucket[];
  has_more: boolean;
  next_page?: string;
}

/** Build query string for the Anthropic usage report endpoint. */
function buildUrl(startingAt: string, endingAt: string, page?: string): string {
  const params = new URLSearchParams({
    starting_at: startingAt,
    ending_at: endingAt,
    bucket_width: "1d",
    "group_by[]": "model",
  });
  if (page) params.set("page", page);
  return `${ANTHROPIC_API_BASE}/v1/organizations/usage_report/messages?${params.toString()}`;
}

/** Fetch a single page from the Anthropic usage API. */
async function fetchPage(
  apiKey: string,
  startingAt: string,
  endingAt: string,
  page?: string,
): Promise<UsageResponse> {
  const url = buildUrl(startingAt, endingAt, page);
  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Anthropic usage API returned ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as UsageResponse;
}

/** Aggregate buckets by model into ProviderUsageRecords. */
function aggregateBuckets(buckets: UsageBucket[]): ProviderUsageRecord[] {
  const byModel = new Map<string, { input: number; output: number; requests: number }>();

  for (const bucket of buckets) {
    const model = bucket.model ?? "unknown";
    const existing = byModel.get(model) ?? { input: 0, output: 0, requests: 0 };
    existing.input +=
      bucket.input_tokens +
      (bucket.cache_read_input_tokens ?? 0) +
      (bucket.cache_creation_input_tokens ?? 0);
    existing.output += bucket.output_tokens;
    existing.requests += bucket.num_requests ?? 0;
    byModel.set(model, existing);
  }

  const records: ProviderUsageRecord[] = [];
  for (const [model, data] of byModel) {
    if (data.requests === 0) continue;
    records.push({
      model,
      requestCount: data.requests,
      totalInputTokens: data.input,
      totalOutputTokens: data.output,
      avgInputTokens: Math.round(data.input / data.requests),
      avgOutputTokens: Math.round(data.output / data.requests),
    });
  }

  return records;
}

/**
 * Fetch actual usage data from the Anthropic Admin API.
 * Requires ANTHROPIC_ADMIN_API_KEY env var.
 * Returns null if the env var is not set.
 */
export async function fetchAnthropicUsage(days: number): Promise<ProviderUsageResult | null> {
  const apiKey = process.env[ENV_KEY];
  if (!apiKey) return null;

  const endingAt = new Date().toISOString();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startingAt = startDate.toISOString();

  const allBuckets: UsageBucket[] = [];
  let page: string | undefined;

  do {
    const result = await fetchPage(apiKey, startingAt, endingAt, page);
    allBuckets.push(...result.data);
    page = result.has_more ? result.next_page : undefined;
  } while (page);

  return {
    provider: "anthropic",
    records: aggregateBuckets(allBuckets),
    periodStart: startingAt,
    periodEnd: endingAt,
  };
}
