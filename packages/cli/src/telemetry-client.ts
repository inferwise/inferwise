/**
 * Telemetry client that fetches production token usage from OTel-compatible backends.
 *
 * Replaces the old stats-client.ts (which called a proprietary Inferwise Cloud API).
 * Reads from any backend that stores GenAI semantic convention traces/metrics:
 *   - Grafana Tempo (via tempo HTTP API)
 *   - Generic OTLP/Prometheus metrics endpoint
 *
 * OTel GenAI span attributes used:
 *   gen_ai.provider.name  → provider
 *   gen_ai.request.model  → model
 *   gen_ai.usage.input_tokens  → input token count
 *   gen_ai.usage.output_tokens → output token count
 */

import { z } from "zod";

/** Stats for a single provider/model pair, used by estimate-core. */
export interface ModelStats {
  provider: string;
  model: string;
  request_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  p50_input_tokens: number;
  p50_output_tokens: number;
  avg_cost_per_request: number;
  total_cost: number;
}

export type TelemetryBackend = "otlp" | "grafana-tempo" | "inferwise-cloud";

export interface TelemetryConfig {
  backend: TelemetryBackend;
  endpoint: string;
  headers?: Record<string, string>;
  apiKey?: string;
}

const telemetryConfigSchema = z.object({
  backend: z.enum(["otlp", "grafana-tempo", "inferwise-cloud"]),
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  apiKey: z.string().optional(),
});

export { telemetryConfigSchema };

// ---------- Grafana Tempo backend ----------

interface TempoSpan {
  attributes: Record<string, unknown>;
}

interface TempoTrace {
  spans: TempoSpan[];
}

interface TempoSearchResponse {
  traces: TempoTrace[];
}

/** Extract a string attribute from a Tempo span. */
function getStringAttr(attrs: Record<string, unknown>, key: string): string | undefined {
  const val = attrs[key];
  return typeof val === "string" ? val : undefined;
}

/** Extract a numeric attribute from a Tempo span. */
function getNumberAttr(attrs: Record<string, unknown>, key: string): number | undefined {
  const val = attrs[key];
  return typeof val === "number" ? val : undefined;
}

interface SpanAggregation {
  provider: string;
  model: string;
  totalInput: number;
  totalOutput: number;
  count: number;
}

/** Query Grafana Tempo for GenAI spans and aggregate token usage. */
async function fetchFromGrafanaTempo(
  config: TelemetryConfig,
  days: number,
): Promise<Map<string, ModelStats> | null> {
  const endNs = Date.now() * 1_000_000;
  const startNs = (Date.now() - days * 86_400_000) * 1_000_000;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(config.headers ?? {}),
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  // Tempo search API: find traces with gen_ai spans
  const searchUrl = new URL("/api/search", config.endpoint);
  searchUrl.searchParams.set("tags", "gen_ai.provider.name");
  searchUrl.searchParams.set("start", String(Math.floor(startNs / 1_000_000_000)));
  searchUrl.searchParams.set("end", String(Math.floor(endNs / 1_000_000_000)));
  searchUrl.searchParams.set("limit", "5000");

  const response = await fetch(searchUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Grafana Tempo returned ${response.status}: ${response.statusText}`);
  }

  const body = (await response.json()) as TempoSearchResponse;
  if (!body.traces || body.traces.length === 0) return null;

  return aggregateTempoTraces(body.traces);
}

/** Aggregate Tempo trace spans into ModelStats. */
function aggregateTempoTraces(traces: TempoTrace[]): Map<string, ModelStats> | null {
  const byModel = new Map<string, SpanAggregation>();

  for (const trace of traces) {
    for (const span of trace.spans ?? []) {
      const attrs = span.attributes ?? {};
      const provider = getStringAttr(attrs, "gen_ai.provider.name");
      const model =
        getStringAttr(attrs, "gen_ai.response.model") ??
        getStringAttr(attrs, "gen_ai.request.model");
      const inputTokens = getNumberAttr(attrs, "gen_ai.usage.input_tokens");
      const outputTokens = getNumberAttr(attrs, "gen_ai.usage.output_tokens");

      if (!provider || !model) continue;
      if (inputTokens === undefined && outputTokens === undefined) continue;

      const key = `${provider}/${model}`;
      const existing = byModel.get(key) ?? {
        provider,
        model,
        totalInput: 0,
        totalOutput: 0,
        count: 0,
      };

      existing.totalInput += inputTokens ?? 0;
      existing.totalOutput += outputTokens ?? 0;
      existing.count += 1;
      byModel.set(key, existing);
    }
  }

  if (byModel.size === 0) return null;

  const statsMap = new Map<string, ModelStats>();
  for (const [key, agg] of byModel) {
    if (agg.count === 0) continue;
    statsMap.set(key, {
      provider: agg.provider,
      model: agg.model,
      request_count: agg.count,
      avg_input_tokens: Math.round(agg.totalInput / agg.count),
      avg_output_tokens: Math.round(agg.totalOutput / agg.count),
      p50_input_tokens: Math.round(agg.totalInput / agg.count),
      p50_output_tokens: Math.round(agg.totalOutput / agg.count),
      avg_cost_per_request: 0,
      total_cost: 0,
    });
  }

  return statsMap;
}

// ---------- OTLP Prometheus metrics backend ----------

interface PrometheusResult {
  metric: Record<string, string>;
  values?: [number, string][];
  value?: [number, string];
}

interface PrometheusQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResult[];
  };
}

/** Query an OTLP/Prometheus metrics endpoint for gen_ai.client.token.usage. */
async function fetchFromOtlpMetrics(
  config: TelemetryConfig,
  days: number,
): Promise<Map<string, ModelStats> | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(config.headers ?? {}),
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  // Query sum of input tokens per model
  const inputQuery = `sum by (gen_ai_provider_name, gen_ai_request_model) (increase(gen_ai_client_token_usage_sum{gen_ai_token_type="input"}[${days}d]))`;
  const outputQuery = `sum by (gen_ai_provider_name, gen_ai_request_model) (increase(gen_ai_client_token_usage_sum{gen_ai_token_type="output"}[${days}d]))`;
  const countQuery = `sum by (gen_ai_provider_name, gen_ai_request_model) (increase(gen_ai_client_token_usage_count{gen_ai_token_type="input"}[${days}d]))`;

  const [inputResults, outputResults, countResults] = await Promise.all([
    queryPrometheus(config.endpoint, inputQuery, headers),
    queryPrometheus(config.endpoint, outputQuery, headers),
    queryPrometheus(config.endpoint, countQuery, headers),
  ]);

  if (!inputResults && !outputResults) return null;

  return mergePrometheusResults(inputResults ?? [], outputResults ?? [], countResults ?? []);
}

/** Execute a single PromQL query. */
async function queryPrometheus(
  endpoint: string,
  query: string,
  headers: Record<string, string>,
): Promise<PrometheusResult[] | null> {
  const url = new URL("/api/v1/query", endpoint);
  url.searchParams.set("query", query);

  const response = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as PrometheusQueryResponse;
  if (body.status !== "success" || !body.data?.result) return null;

  return body.data.result;
}

/** Merge input, output, and count Prometheus results into a stats map. */
function mergePrometheusResults(
  inputResults: PrometheusResult[],
  outputResults: PrometheusResult[],
  countResults: PrometheusResult[],
): Map<string, ModelStats> | null {
  const byModel = new Map<
    string,
    { provider: string; model: string; input: number; output: number; count: number }
  >();

  for (const r of inputResults) {
    const provider = r.metric.gen_ai_provider_name ?? "";
    const model = r.metric.gen_ai_request_model ?? "";
    if (!provider || !model) continue;
    const key = `${provider}/${model}`;
    const val = extractValue(r);
    const existing = byModel.get(key) ?? { provider, model, input: 0, output: 0, count: 0 };
    existing.input = val;
    byModel.set(key, existing);
  }

  for (const r of outputResults) {
    const provider = r.metric.gen_ai_provider_name ?? "";
    const model = r.metric.gen_ai_request_model ?? "";
    if (!provider || !model) continue;
    const key = `${provider}/${model}`;
    const existing = byModel.get(key) ?? { provider, model, input: 0, output: 0, count: 0 };
    existing.output = extractValue(r);
    byModel.set(key, existing);
  }

  for (const r of countResults) {
    const provider = r.metric.gen_ai_provider_name ?? "";
    const model = r.metric.gen_ai_request_model ?? "";
    if (!provider || !model) continue;
    const key = `${provider}/${model}`;
    const existing = byModel.get(key) ?? { provider, model, input: 0, output: 0, count: 0 };
    existing.count = extractValue(r);
    byModel.set(key, existing);
  }

  if (byModel.size === 0) return null;

  const statsMap = new Map<string, ModelStats>();
  for (const [key, agg] of byModel) {
    const count = Math.max(1, Math.round(agg.count));
    statsMap.set(key, {
      provider: agg.provider,
      model: agg.model,
      request_count: count,
      avg_input_tokens: Math.round(agg.input / count),
      avg_output_tokens: Math.round(agg.output / count),
      p50_input_tokens: Math.round(agg.input / count),
      p50_output_tokens: Math.round(agg.output / count),
      avg_cost_per_request: 0,
      total_cost: 0,
    });
  }

  return statsMap;
}

/** Extract the scalar value from a Prometheus instant or range result. */
function extractValue(result: PrometheusResult): number {
  if (result.value) {
    return Number.parseFloat(result.value[1] ?? "0") || 0;
  }
  if (result.values && result.values.length > 0) {
    const last = result.values[result.values.length - 1];
    return Number.parseFloat(last?.[1] ?? "0") || 0;
  }
  return 0;
}

// ---------- Legacy Inferwise Cloud backend ----------

const statsResponseSchema = z.object({
  models: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      request_count: z.number(),
      avg_input_tokens: z.number(),
      avg_output_tokens: z.number(),
      p50_input_tokens: z.number(),
      p50_output_tokens: z.number(),
      avg_cost_per_request: z.number(),
      total_cost: z.number(),
    }),
  ),
});

/** Fetch from the legacy Inferwise Cloud API (/v1/stats). */
async function fetchFromInferwiseCloud(
  config: TelemetryConfig,
): Promise<Map<string, ModelStats> | null> {
  try {
    const url = `${config.endpoint}/v1/stats`;
    const headers: Record<string, string> = {
      ...(config.headers ?? {}),
    };
    if (config.apiKey) {
      headers["x-inferwise-key"] = config.apiKey;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const json: unknown = await response.json();
    const parsed = statsResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    const map = new Map<string, ModelStats>();
    for (const model of parsed.data.models) {
      map.set(`${model.provider}/${model.model}`, model);
    }
    return map;
  } catch {
    return null;
  }
}

// ---------- Public API ----------

/**
 * Fetch production usage stats from the configured telemetry backend.
 * Returns a map of "provider/model" → stats, or null if unavailable.
 *
 * Supports three backends:
 *   - "grafana-tempo": Queries Grafana Tempo for GenAI semantic convention spans
 *   - "otlp": Queries a Prometheus-compatible metrics endpoint for gen_ai.client.token.usage
 *   - "inferwise-cloud": Legacy Inferwise Cloud API (backward-compatible)
 */
export async function fetchProductionStats(
  config: TelemetryConfig,
  days = 30,
): Promise<Map<string, ModelStats> | null> {
  switch (config.backend) {
    case "grafana-tempo":
      return fetchFromGrafanaTempo(config, days);
    case "otlp":
      return fetchFromOtlpMetrics(config, days);
    case "inferwise-cloud":
      return fetchFromInferwiseCloud(config);
  }
}

/**
 * Build a TelemetryConfig from legacy apiUrl/apiKey fields.
 * Used for backward compatibility with existing configs that have apiUrl + apiKey.
 */
export function buildLegacyTelemetryConfig(apiUrl: string, apiKey: string): TelemetryConfig {
  return {
    backend: "inferwise-cloud",
    endpoint: apiUrl,
    apiKey,
  };
}
