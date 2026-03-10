import type { ProviderUsageRecord, ProviderUsageResult } from "./types.js";

const OPENAI_API_BASE = "https://api.openai.com";
const ENV_KEY = "OPENAI_API_KEY";

interface UsageBucket {
  input_tokens: number;
  output_tokens: number;
  num_model_requests: number;
  model?: string;
  cached_input_tokens?: number;
}

interface CompletionsUsageResponse {
  data: UsageBucket[];
  has_more: boolean;
  next_page?: string;
}

/** Build URL for the OpenAI completions usage endpoint. */
function buildUrl(startTime: number, endTime: number, page?: string): string {
  const params = new URLSearchParams({
    start_time: startTime.toString(),
    end_time: endTime.toString(),
    bucket_width: "1d",
    "group_by[]": "model",
  });
  if (page) params.set("page", page);
  return `${OPENAI_API_BASE}/v1/organization/usage/completions?${params.toString()}`;
}

/** Fetch a single page from the OpenAI usage API. */
async function fetchPage(
  apiKey: string,
  startTime: number,
  endTime: number,
  page?: string,
): Promise<CompletionsUsageResponse> {
  const url = buildUrl(startTime, endTime, page);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI usage API returned ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as CompletionsUsageResponse;
}

/** Aggregate buckets by model into ProviderUsageRecords. */
function aggregateBuckets(buckets: UsageBucket[]): ProviderUsageRecord[] {
  const byModel = new Map<string, { input: number; output: number; requests: number }>();

  for (const bucket of buckets) {
    const model = bucket.model ?? "unknown";
    const existing = byModel.get(model) ?? { input: 0, output: 0, requests: 0 };
    existing.input += bucket.input_tokens + (bucket.cached_input_tokens ?? 0);
    existing.output += bucket.output_tokens;
    existing.requests += bucket.num_model_requests;
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
 * Fetch actual usage data from the OpenAI Organization Usage API.
 * Requires OPENAI_API_KEY env var (with org usage permissions).
 * Returns null if the env var is not set.
 */
export async function fetchOpenAIUsage(days: number): Promise<ProviderUsageResult | null> {
  const apiKey = process.env[ENV_KEY];
  if (!apiKey) return null;

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - days * 86400;

  const allBuckets: UsageBucket[] = [];
  let page: string | undefined;

  do {
    const result = await fetchPage(apiKey, startTime, endTime, page);
    allBuckets.push(...result.data);
    page = result.has_more ? result.next_page : undefined;
  } while (page);

  const periodStart = new Date(startTime * 1000).toISOString();
  const periodEnd = new Date(endTime * 1000).toISOString();

  return {
    provider: "openai",
    records: aggregateBuckets(allBuckets),
    periodStart,
    periodEnd,
  };
}
