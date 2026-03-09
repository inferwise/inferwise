import anthropicData from "../providers/anthropic.json" with { type: "json" };
import googleData from "../providers/google.json" with { type: "json" };
import openaiData from "../providers/openai.json" with { type: "json" };
import xaiData from "../providers/xai.json" with { type: "json" };

export type Provider = "anthropic" | "openai" | "google" | "xai";
export type ModelTier = "budget" | "mid" | "premium";
export type ModelStatus = "current" | "legacy" | "deprecated";
export type Capability =
  | "code"
  | "reasoning"
  | "general"
  | "creative"
  | "vision"
  | "search"
  | "audio";

/** Thresholds for auto-tier derivation based on output_cost_per_million. */
const TIER_THRESHOLDS = { budget: 5, premium: 20 } as const;

/** Derive cost tier from output pricing. */
export function computeTier(outputCostPerMillion: number): ModelTier {
  if (outputCostPerMillion <= TIER_THRESHOLDS.budget) return "budget";
  if (outputCostPerMillion < TIER_THRESHOLDS.premium) return "mid";
  return "premium";
}

export interface ModelPricing {
  id: string;
  name: string;
  provider: Provider;
  aliases: string[];
  status: ModelStatus;
  /** USD per million input tokens (standard) */
  input_cost_per_million: number;
  /** USD per million output tokens (standard) */
  output_cost_per_million: number;
  /** USD per million cached input tokens (cache hit) */
  cache_read_input_cost_per_million?: number;
  /** USD per million tokens written to cache (cache creation) */
  cache_write_input_cost_per_million?: number;
  /** USD per million input tokens via Batch API */
  batch_input_cost_per_million?: number;
  /** USD per million output tokens via Batch API */
  batch_output_cost_per_million?: number;
  /** USD per million input tokens in fast/priority mode */
  fast_input_cost_per_million?: number;
  /** USD per million output tokens in fast/priority mode */
  fast_output_cost_per_million?: number;
  /** USD per million input tokens above 200K context (long-context tier) */
  input_cost_above_200k_per_million?: number;
  /** USD per million output tokens above 200K context */
  output_cost_above_200k_per_million?: number;
  context_window: number;
  max_output_tokens: number;
  supports_vision: boolean;
  supports_tools: boolean;
  supports_prompt_caching: boolean;
  supports_reasoning: boolean;
  supports_computer_use: boolean;
  /** Derived automatically from output_cost_per_million. */
  tier: ModelTier;
  capabilities: Capability[];
  knowledge_cutoff?: string;
}

export interface ProviderMeta {
  provider: Provider;
  last_updated: string;
  last_verified: string;
  source: string;
}

export interface ProviderData extends ProviderMeta {
  models: Omit<ModelPricing, "provider" | "tier">[];
}

const PROVIDERS: Record<Provider, ProviderData> = {
  anthropic: anthropicData as ProviderData,
  openai: openaiData as ProviderData,
  google: googleData as ProviderData,
  xai: xaiData as ProviderData,
};

/** Get all models for a provider, enriched with provider and computed tier. */
export function getProviderModels(provider: Provider): ModelPricing[] {
  const data = PROVIDERS[provider];
  return data.models.map((model) => ({
    ...model,
    provider,
    tier: computeTier(model.output_cost_per_million),
  }));
}

/** Strip common prefixes that frameworks add to model IDs. */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/^(models\/|gemini\/|xai\/|openai\/)/, "");
}

/**
 * Look up a model by canonical ID or alias.
 * Checks canonical ID first, then aliases, then tries with stripped prefixes.
 */
export function getModel(provider: Provider, modelId: string): ModelPricing | undefined {
  const models = getProviderModels(provider);

  // Exact match on ID
  const byId = models.find((m) => m.id === modelId);
  if (byId) return byId;

  // Exact match on alias
  const byAlias = models.find((m) => m.aliases.includes(modelId));
  if (byAlias) return byAlias;

  // Fuzzy: strip common prefixes and retry
  const normalized = normalizeModelId(modelId);
  if (normalized !== modelId) {
    const byNormId = models.find((m) => m.id === normalized);
    if (byNormId) return byNormId;
    return models.find((m) => m.aliases.includes(normalized));
  }

  return undefined;
}

/** Get all models across all providers. */
export function getAllModels(): ModelPricing[] {
  return (Object.keys(PROVIDERS) as Provider[]).flatMap(getProviderModels);
}

/** Get all supported provider names. */
export function getAllProviders(): Provider[] {
  return Object.keys(PROVIDERS) as Provider[];
}

/** Get metadata for a provider (dates, source URL). */
export function getProviderMeta(provider: Provider): ProviderMeta {
  const { provider: p, last_updated, last_verified, source } = PROVIDERS[provider];
  return { provider: p, last_updated, last_verified, source };
}

/** Return number of days since a provider's pricing was last verified. */
export function getPricingAgeInDays(provider: Provider): number {
  const { last_verified } = PROVIDERS[provider];
  const ms = Date.now() - new Date(last_verified).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export interface CostParams {
  model: ModelPricing;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from cache (subset of inputTokens). Defaults to 0. */
  cachedInputTokens?: number;
  /** Use Batch API pricing if available. Defaults to false. */
  useBatch?: boolean;
  /** Use fast/priority mode pricing if available. Defaults to false. */
  useFast?: boolean;
  /**
   * Request exceeds 200K tokens — use long-context pricing tier if available.
   * Defaults to false (auto-detected if inputTokens > 200_000).
   */
  isLongContext?: boolean;
}

/**
 * Calculate total USD cost for a request.
 *
 * Priority for each dimension: fast > batch > long-context > standard.
 * Cache savings are applied to the cached portion of input separately.
 */
export function calculateCost(params: CostParams): number {
  const {
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens = 0,
    useBatch = false,
    useFast = false,
  } = params;

  // Auto-detect long context if not explicitly set
  const isLongContext = params.isLongContext ?? inputTokens > 200_000;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  // Input cost (uncached portion)
  let inputRatePerMillion: number;
  if (useFast && model.fast_input_cost_per_million !== undefined) {
    inputRatePerMillion = model.fast_input_cost_per_million;
  } else if (useBatch && model.batch_input_cost_per_million !== undefined) {
    inputRatePerMillion = model.batch_input_cost_per_million;
  } else if (isLongContext && model.input_cost_above_200k_per_million !== undefined) {
    inputRatePerMillion = model.input_cost_above_200k_per_million;
  } else {
    inputRatePerMillion = model.input_cost_per_million;
  }

  // Output cost
  let outputRatePerMillion: number;
  if (useFast && model.fast_output_cost_per_million !== undefined) {
    outputRatePerMillion = model.fast_output_cost_per_million;
  } else if (useBatch && model.batch_output_cost_per_million !== undefined) {
    outputRatePerMillion = model.batch_output_cost_per_million;
  } else if (isLongContext && model.output_cost_above_200k_per_million !== undefined) {
    outputRatePerMillion = model.output_cost_above_200k_per_million;
  } else {
    outputRatePerMillion = model.output_cost_per_million;
  }

  const inputCost = (uncachedInputTokens / 1_000_000) * inputRatePerMillion;
  const cachedCost =
    cachedInputTokens > 0 && model.cache_read_input_cost_per_million !== undefined
      ? (cachedInputTokens / 1_000_000) * model.cache_read_input_cost_per_million
      : 0;
  const outputCost = (outputTokens / 1_000_000) * outputRatePerMillion;

  return inputCost + cachedCost + outputCost;
}
