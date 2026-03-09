import { z } from "zod";

const modelStatsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  request_count: z.number(),
  avg_input_tokens: z.number(),
  avg_output_tokens: z.number(),
  p50_input_tokens: z.number(),
  p50_output_tokens: z.number(),
  avg_cost_per_request: z.number(),
  total_cost: z.number(),
});

const statsResponseSchema = z.object({
  models: z.array(modelStatsSchema),
});

export type ModelStats = z.infer<typeof modelStatsSchema>;

/**
 * Fetch production usage stats from the Inferwise Cloud API.
 * Returns a map of "provider/model" → stats, or null if unavailable.
 */
export async function fetchProductionStats(
  apiUrl: string,
  apiKey: string,
): Promise<Map<string, ModelStats> | null> {
  try {
    const url = `${apiUrl}/v1/stats`;
    const response = await fetch(url, {
      headers: { "x-inferwise-key": apiKey },
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
