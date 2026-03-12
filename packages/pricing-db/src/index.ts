import benchmarkData from "../benchmarks.json" with { type: "json" };
import anthropicData from "../providers/anthropic.json" with { type: "json" };
import googleData from "../providers/google.json" with { type: "json" };
import openaiData from "../providers/openai.json" with { type: "json" };
import perplexityData from "../providers/perplexity.json" with { type: "json" };
import xaiData from "../providers/xai.json" with { type: "json" };

export type Provider = "anthropic" | "openai" | "google" | "xai" | "perplexity";
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
  perplexity: perplexityData as ProviderData,
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

/**
 * Strip platform/routing prefixes and version suffixes from model IDs.
 * Handles: LiteLLM routing (bedrock/, azure/, vertex_ai/), framework prefixes
 * (models/, gemini/), Bedrock provider prefixes (anthropic.), and Bedrock
 * version suffixes (-v1:0).
 */
export function normalizeModelId(modelId: string): string {
  let id = modelId;
  // OpenRouter prefix — strip it and then strip any nested provider prefix
  id = id.replace(/^openrouter\//, "");
  // Gateway / proxy routing prefixes (cloud routing, inference gateways)
  // e.g., "aws/anthropic/bedrock-claude-opus-4-6" → "bedrock-claude-opus-4-6"
  id = id.replace(/^(aws|gcp|azure)\/(anthropic|openai|google|meta|mistralai|cohere|ai21)\//, "");
  // LiteLLM routing prefixes
  id = id.replace(/^(bedrock\/|azure\/|vertex_ai\/|azure_ai\/)/, "");
  // Framework prefixes (also strips nested provider prefix after openrouter/)
  id = id.replace(
    /^(models\/|gemini\/|xai\/|openai\/|perplexity\/|anthropic\/|google\/|meta-llama\/|meta\/|mistralai\/)/,
    "",
  );
  // Gateway model-name prefixes (e.g., "bedrock-claude-opus-4-6" → "claude-opus-4-6")
  id = id.replace(/^bedrock-/, "");
  // Bedrock provider prefixes
  id = id.replace(/^(anthropic|amazon|meta|cohere|ai21|mistral|stability)\./, "");
  // Bedrock version suffix
  id = id.replace(/-v\d+:\d+$/, "");
  return id;
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
  const effectiveCached = Math.min(cachedInputTokens, inputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - effectiveCached);

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
    effectiveCached > 0 && model.cache_read_input_cost_per_million !== undefined
      ? (effectiveCached / 1_000_000) * model.cache_read_input_cost_per_million
      : 0;
  const outputCost = (outputTokens / 1_000_000) * outputRatePerMillion;

  return inputCost + cachedCost + outputCost;
}

// ── Benchmark quality scores ─────────────────────────────────────────

/** Quality benchmark scores for a model, normalized 0-100. */
export interface ModelBenchmarks {
  overall: number;
  coding?: number;
  reasoning?: number;
  math?: number;
  creative_writing?: number;
  instruction_following?: number;
  arena_elo?: number;
  arena_rank?: number;
  primary_source: string;
  note?: string;
}

/** Mapping from capability to benchmark category field. */
const CAPABILITY_TO_BENCHMARK: Record<Capability, keyof ModelBenchmarks> = {
  code: "coding",
  reasoning: "reasoning",
  general: "overall",
  creative: "creative_writing",
  vision: "overall",
  search: "overall",
  audio: "overall",
};

const benchmarks = benchmarkData.models as Record<string, ModelBenchmarks>;

/** Get benchmark scores for a model. Returns undefined if not benchmarked. */
export function getModelBenchmarks(
  provider: Provider,
  modelId: string,
): ModelBenchmarks | undefined {
  const key = `${provider}/${modelId}`;
  if (benchmarks[key]) return benchmarks[key];

  // Try normalized ID
  const normalized = normalizeModelId(modelId);
  if (normalized !== modelId) {
    const normKey = `${provider}/${normalized}`;
    if (benchmarks[normKey]) return benchmarks[normKey];
  }

  // Try alias lookup — find the canonical model, then look up by canonical ID
  const model = getModel(provider, modelId);
  if (model && model.id !== modelId) {
    const canonKey = `${provider}/${model.id}`;
    if (benchmarks[canonKey]) return benchmarks[canonKey];
  }

  return undefined;
}

/**
 * Get quality score for a model on a specific capability.
 * Returns the benchmark category score mapped from the capability.
 * For multi-capability tasks, call once per capability and take the minimum.
 */
export function getQualityScore(
  provider: Provider,
  modelId: string,
  capability: Capability,
): number | undefined {
  const bench = getModelBenchmarks(provider, modelId);
  if (!bench) return undefined;

  const field = CAPABILITY_TO_BENCHMARK[capability];
  const score = bench[field];
  return typeof score === "number" ? score : bench.overall;
}

/**
 * Get the minimum quality score across multiple capabilities.
 * Conservative: model must be good at ALL required capabilities.
 */
export function getMinQualityScore(
  provider: Provider,
  modelId: string,
  capabilities: Capability[],
): number | undefined {
  const scores: number[] = [];
  for (const cap of capabilities) {
    const score = getQualityScore(provider, modelId, cap);
    if (score === undefined) return undefined;
    scores.push(score);
  }
  return scores.length > 0 ? Math.min(...scores) : undefined;
}

// ── Capability inference + model suggestion ──────────────────────────

/** Keyword patterns mapped to capabilities for use-case inference. */
const CAPABILITY_KEYWORDS: Array<{ capability: Capability; patterns: RegExp }> = [
  {
    capability: "code",
    patterns:
      /\b(code|coding|debug|refactor|function|typescript|python|javascript|programming|syntax|compile|lint|regex|sql|api endpoint)\b/i,
  },
  {
    capability: "reasoning",
    patterns:
      /\b(step[- ]by[- ]step|analyze|reason|think carefully|evaluate|logic|math|proof|calculate|deduce|chain of thought)\b/i,
  },
  {
    capability: "creative",
    patterns: /\b(story|creative|poem|narrative|fiction|blog post|essay|copywriting)\b/i,
  },
  {
    capability: "vision",
    patterns: /\b(image|screenshot|photo|picture|diagram|chart|visual|ocr|describe the image)\b/i,
  },
  {
    capability: "search",
    patterns: /\b(search|find information|look up|latest news|real[- ]time)\b/i,
  },
  {
    capability: "audio",
    patterns: /\b(audio|transcribe|speech|voice|listen)\b/i,
  },
];

/** Infer required capabilities from free-form text (prompt, task description). */
export function inferRequiredCapabilities(text: string): Capability[] {
  if (!text.trim()) return ["general"];

  const matched = new Set<Capability>();
  for (const { capability, patterns } of CAPABILITY_KEYWORDS) {
    if (patterns.test(text)) matched.add(capability);
  }

  return matched.size > 0 ? [...matched] : ["general"];
}

/** Options for filtering models by capabilities. */
export interface ModelFilterOptions {
  provider?: Provider;
  status?: ModelStatus;
  maxOutputCostPerMillion?: number;
}

/** Get all models that support ALL specified capabilities. */
export function getModelsByCapabilities(
  required: Capability[],
  options?: ModelFilterOptions,
): ModelPricing[] {
  const status = options?.status ?? "current";
  const source = options?.provider ? getProviderModels(options.provider) : getAllModels();

  return source
    .filter((m) => {
      if (m.status !== status) return false;
      if (options?.maxOutputCostPerMillion !== undefined) {
        if (m.output_cost_per_million > options.maxOutputCostPerMillion) return false;
      }
      return required.every((cap) => m.capabilities.includes(cap));
    })
    .sort((a, b) => a.output_cost_per_million - b.output_cost_per_million);
}

/** A suggested alternative model with reasoning. */
export interface AlternativeSuggestion {
  model: ModelPricing;
  reasoning: string;
  savingsPercent: number;
  /** Quality score of the suggested model (0-100), if benchmark data exists. */
  qualityScore?: number;
  /** Quality score of the current model (0-100), if benchmark data exists. */
  currentQualityScore?: number;
}

/** Options for controlling alternative suggestions. */
export interface SuggestAlternativesOptions {
  /** Confidence in capability inference. Restricts how aggressively we suggest. */
  confidence?: "high" | "medium" | "low";
  /** Minimum quality ratio vs current model (0-1). Default: 0.7 (70%). */
  minQualityRatio?: number;
}

/** Tier ordering for tier-distance calculations. */
const TIER_ORDER: Record<ModelTier, number> = { budget: 0, mid: 1, premium: 2 };

/** Default minimum quality ratio — candidate must be ≥70% of current model's quality. */
const DEFAULT_MIN_QUALITY_RATIO = 0.7;

/** Suggest cheaper alternatives that match required capabilities. */
export function suggestAlternatives(
  currentModelId: string,
  currentProvider: Provider,
  requiredCapabilities: Capability[],
  options?: SuggestAlternativesOptions,
): AlternativeSuggestion[] {
  const current = getModel(currentProvider, currentModelId);
  if (!current) return [];

  const confidence = options?.confidence ?? "medium";
  const minQualityRatio = options?.minQualityRatio ?? DEFAULT_MIN_QUALITY_RATIO;

  const currentQuality = getMinQualityScore(currentProvider, currentModelId, requiredCapabilities);

  const candidates = getModelsByCapabilities(requiredCapabilities)
    .filter((m) => !(m.id === current.id && m.provider === current.provider))
    .filter((m) => m.output_cost_per_million < current.output_cost_per_million)
    .filter((m) => {
      const currentTier = TIER_ORDER[current.tier];
      const candidateTier = TIER_ORDER[m.tier];
      const tierDrop = currentTier - candidateTier;

      // Low confidence: same provider + same tier only
      if (confidence === "low") {
        return m.provider === currentProvider && tierDrop <= 0;
      }
      // Medium confidence: max 1 tier drop (cross-provider OK)
      if (confidence === "medium") {
        return tierDrop <= 1;
      }
      // High confidence: allow any tier drop
      return true;
    })
    .filter((m) => {
      // Quality gate: skip if benchmark data is missing for either model
      if (currentQuality === undefined) return true;
      const candidateQuality = getMinQualityScore(m.provider, m.id, requiredCapabilities);
      if (candidateQuality === undefined) return true;
      return candidateQuality >= currentQuality * minQualityRatio;
    });

  // Representative token counts for cost comparison (typical workload)
  const REF_INPUT = 4096;
  const REF_OUTPUT = 1024;
  const currentTotalCost = calculateCost({
    model: current,
    inputTokens: REF_INPUT,
    outputTokens: REF_OUTPUT,
  });

  // Sort by quality-adjusted cost (cost / quality) instead of raw cost
  const sorted = candidates.sort((a, b) => {
    const aCost = calculateCost({ model: a, inputTokens: REF_INPUT, outputTokens: REF_OUTPUT });
    const bCost = calculateCost({ model: b, inputTokens: REF_INPUT, outputTokens: REF_OUTPUT });
    const aQuality = getMinQualityScore(a.provider, a.id, requiredCapabilities);
    const bQuality = getMinQualityScore(b.provider, b.id, requiredCapabilities);
    const aAdj = aQuality ? aCost / (aQuality / 100) : aCost;
    const bAdj = bQuality ? bCost / (bQuality / 100) : bCost;
    return aAdj - bAdj;
  });

  return sorted.slice(0, 3).map((m) => {
    const candidateTotalCost = calculateCost({
      model: m,
      inputTokens: REF_INPUT,
      outputTokens: REF_OUTPUT,
    });
    const savings =
      currentTotalCost > 0
        ? Math.round(((currentTotalCost - candidateTotalCost) / currentTotalCost) * 100)
        : 0;
    const caps = `[${requiredCapabilities.join(", ")}]`;
    const candidateQuality = getMinQualityScore(m.provider, m.id, requiredCapabilities);
    const qualitySuffix =
      candidateQuality !== undefined && currentQuality !== undefined
        ? ` (quality: ${candidateQuality} vs ${currentQuality})`
        : "";
    const reasoning =
      m.provider === currentProvider
        ? `Task requires ${caps} — ${m.name} handles that at ${savings}% lower cost${qualitySuffix}`
        : `Task requires ${caps} — ${m.provider}/${m.name} handles that at ${savings}% lower cost${qualitySuffix}`;
    return {
      model: m,
      reasoning,
      savingsPercent: savings,
      ...(candidateQuality !== undefined ? { qualityScore: candidateQuality } : {}),
      ...(currentQuality !== undefined ? { currentQualityScore: currentQuality } : {}),
    };
  });
}

/** Result of a task-based model suggestion. */
export interface TaskSuggestion {
  model: ModelPricing;
  inferredCapabilities: Capability[];
  reasoning: string;
}

/** Suggest the best value model for a free-form task description. */
export function suggestModelForTask(
  text: string,
  options?: { provider?: Provider; maxCostPerMillion?: number },
): TaskSuggestion | undefined {
  const capabilities = inferRequiredCapabilities(text);
  const candidates = getModelsByCapabilities(capabilities, {
    ...(options?.provider ? { provider: options.provider } : {}),
    ...(options?.maxCostPerMillion ? { maxOutputCostPerMillion: options.maxCostPerMillion } : {}),
  });

  if (candidates.length === 0) return undefined;

  // Sort by quality-adjusted cost (cost / quality) for best value
  const sorted = [...candidates].sort((a, b) => {
    const aQuality = getMinQualityScore(a.provider, a.id, capabilities);
    const bQuality = getMinQualityScore(b.provider, b.id, capabilities);
    const aAdj = aQuality
      ? a.output_cost_per_million / (aQuality / 100)
      : a.output_cost_per_million;
    const bAdj = bQuality
      ? b.output_cost_per_million / (bQuality / 100)
      : b.output_cost_per_million;
    return aAdj - bAdj;
  });

  const best = sorted[0];
  if (!best) return undefined;

  const caps = `[${capabilities.join(", ")}]`;
  const quality = getMinQualityScore(best.provider, best.id, capabilities);
  const qualitySuffix = quality !== undefined ? ` — quality: ${quality}/100` : "";
  const reasoning = `Inferred capabilities: ${caps} — ${best.provider}/${best.name} ($${best.output_cost_per_million}/M output) is the best value model${qualitySuffix}`;

  return { model: best, inferredCapabilities: capabilities, reasoning };
}
