type Provider = "anthropic" | "openai" | "google" | "xai";
type ModelTier = "budget" | "mid" | "premium";
type ModelStatus = "current" | "legacy" | "deprecated";
type Capability = "code" | "reasoning" | "general" | "creative" | "vision" | "search" | "audio";
interface ModelPricing {
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
    tier: ModelTier;
    capabilities: Capability[];
    knowledge_cutoff?: string;
}
interface ProviderMeta {
    provider: Provider;
    last_updated: string;
    last_verified: string;
    source: string;
}
interface ProviderData extends ProviderMeta {
    models: Omit<ModelPricing, "provider">[];
}
/** Get all models for a provider, enriched with the provider field. */
declare function getProviderModels(provider: Provider): ModelPricing[];
/**
 * Look up a model by canonical ID or alias.
 * Checks canonical ID first, then aliases array.
 */
declare function getModel(provider: Provider, modelId: string): ModelPricing | undefined;
/** Get all models across all providers. */
declare function getAllModels(): ModelPricing[];
/** Get all supported provider names. */
declare function getAllProviders(): Provider[];
/** Get metadata for a provider (dates, source URL). */
declare function getProviderMeta(provider: Provider): ProviderMeta;
/** Return number of days since a provider's pricing was last verified. */
declare function getPricingAgeInDays(provider: Provider): number;
interface CostParams {
    model: ModelPricing;
    inputTokens: number;
    outputTokens: number;
    /** Tokens served from cache (subset of inputTokens). Defaults to 0. */
    cachedInputTokens?: number;
    /** Use Batch API pricing if available. Defaults to false. */
    useBatch?: boolean;
    /**
     * Request exceeds 200K tokens — use long-context pricing tier if available.
     * Defaults to false (auto-detected if inputTokens > 200_000).
     */
    isLongContext?: boolean;
}
/**
 * Calculate total USD cost for a request.
 *
 * Priority for each dimension: batch > long-context > standard.
 * Cache savings are applied to the cached portion of input separately.
 */
declare function calculateCost(params: CostParams): number;

export { type Capability, type CostParams, type ModelPricing, type ModelStatus, type ModelTier, type Provider, type ProviderData, type ProviderMeta, calculateCost, getAllModels, getAllProviders, getModel, getPricingAgeInDays, getProviderMeta, getProviderModels };
