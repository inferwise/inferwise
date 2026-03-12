import type { Provider } from "@inferwise/pricing-db";
import type { ProviderUsageRecord, ProviderUsageResult } from "./types.js";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const ENV_KEY = "OPENROUTER_API_KEY";

interface ActivityRecord {
  date: string;
  model: string;
  model_permaslug: string;
  provider_name: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
}

interface ActivityResponse {
  data: ActivityRecord[];
}

/** Map OpenRouter provider names (lowercased) to Inferwise provider IDs. */
const PROVIDER_MAP: Record<string, Provider> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "google ai studio": "google",
  "google-ai-studio": "google",
  "vertex ai": "google",
  "vertex-ai": "google",
  xai: "xai",
  perplexity: "perplexity",
};

/**
 * Strip the OpenRouter provider prefix from model IDs.
 * OpenRouter uses "provider/model" format (e.g. "anthropic/claude-sonnet-4").
 */
function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf("/");
  return slashIndex >= 0 ? model.slice(slashIndex + 1) : model;
}

/** Fetch a single day's activity from the OpenRouter API. */
async function fetchActivityPage(apiKey: string, date: string): Promise<ActivityRecord[]> {
  const url = `${OPENROUTER_API_BASE}/activity?date=${date}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter activity API returned ${response.status}: ${response.statusText}`);
  }

  const body = (await response.json()) as ActivityResponse;
  return body.data ?? [];
}

/** Build YYYY-MM-DD date strings for the last N days. */
function buildDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  return dates;
}

interface AggregatedModel {
  provider: Provider;
  model: string;
  input: number;
  output: number;
  requests: number;
}

/** Aggregate activity records by provider + model. */
function aggregateRecords(records: ActivityRecord[]): ProviderUsageResult[] {
  const byKey = new Map<string, AggregatedModel>();

  for (const record of records) {
    if (record.requests === 0) continue;

    const rawModel = record.model ?? record.model_permaslug;
    if (!rawModel) continue;

    const providerName = record.provider_name?.toLowerCase() ?? "";
    const provider = PROVIDER_MAP[providerName];
    if (!provider) continue;

    const model = stripProviderPrefix(rawModel);
    const key = `${provider}/${model}`;

    const existing = byKey.get(key) ?? {
      provider,
      model,
      input: 0,
      output: 0,
      requests: 0,
    };

    existing.input += record.prompt_tokens;
    existing.output += record.completion_tokens + record.reasoning_tokens;
    existing.requests += record.requests;
    byKey.set(key, existing);
  }

  // Group by provider into ProviderUsageResults
  const byProvider = new Map<Provider, ProviderUsageRecord[]>();

  for (const agg of byKey.values()) {
    if (agg.requests === 0) continue;

    const providerRecords = byProvider.get(agg.provider) ?? [];
    providerRecords.push({
      model: agg.model,
      requestCount: agg.requests,
      totalInputTokens: agg.input,
      totalOutputTokens: agg.output,
      avgInputTokens: Math.round(agg.input / agg.requests),
      avgOutputTokens: Math.round(agg.output / agg.requests),
    });
    byProvider.set(agg.provider, providerRecords);
  }

  return [...byProvider.entries()].map(([provider, providerRecords]) => ({
    provider,
    records: providerRecords,
    periodStart: "",
    periodEnd: "",
  }));
}

/**
 * Fetch actual usage data from the OpenRouter Activity API.
 * Returns usage records grouped by Inferwise provider, covering ALL providers routed through OpenRouter.
 * Requires OPENROUTER_API_KEY env var.
 * Returns null if the env var is not set.
 */
export async function fetchOpenRouterUsage(days: number): Promise<ProviderUsageResult[] | null> {
  const apiKey = process.env[ENV_KEY];
  if (!apiKey) return null;

  // OpenRouter API accepts a single date param — fetch each day in the range
  // Limit to 30 days max (OpenRouter only keeps 30 days)
  const effectiveDays = Math.min(days, 30);
  const dates = buildDateRange(effectiveDays);

  const allRecords: ActivityRecord[] = [];

  for (const date of dates) {
    const records = await fetchActivityPage(apiKey, date);
    allRecords.push(...records);
  }

  if (allRecords.length === 0) return null;

  const periodEnd = dates[0] ?? new Date().toISOString().slice(0, 10);
  const periodStart = dates[dates.length - 1] ?? periodEnd;

  const results = aggregateRecords(allRecords);

  // Fill in period dates
  for (const result of results) {
    result.periodStart = periodStart;
    result.periodEnd = periodEnd;
  }

  return results;
}
