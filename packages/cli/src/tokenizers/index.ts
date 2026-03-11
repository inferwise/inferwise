import type { Provider } from "@inferwise/pricing-db";
import { type Tiktoken, type TiktokenModel, encoding_for_model, get_encoding } from "tiktoken";

// Cache encoders keyed by encoding name — creating them is expensive (WASM init).
// Multiple models share the same encoding (e.g. gpt-4o and gpt-4 both use o200k_base),
// so we cache by encoding name, not model name.
const encoderCache = new Map<string, Tiktoken>();

/** Get or create an encoder by encoding name. */
function getEncoderByName(encodingName: string): Tiktoken {
  const cached = encoderCache.get(encodingName);
  if (cached) return cached;
  const enc = get_encoding(encodingName as Parameters<typeof get_encoding>[0]);
  encoderCache.set(encodingName, enc);
  return enc;
}

/**
 * Get or create an encoder for a specific model.
 * Falls back to cl100k_base if the model is not known to tiktoken.
 */
function getEncoderForModel(modelId: string): Tiktoken {
  try {
    const enc = encoding_for_model(modelId as TiktokenModel);
    // encoding_for_model always creates a new instance; check if we already
    // have one cached for this encoding by comparing the model's encoding name.
    // tiktoken doesn't expose the encoding name directly, so we use the model
    // as cache key when it's a known model.
    const cacheKey = `model:${modelId}`;
    const cached = encoderCache.get(cacheKey);
    if (cached) {
      enc.free();
      return cached;
    }
    encoderCache.set(cacheKey, enc);
    return enc;
  } catch {
    return getEncoderByName("cl100k_base");
  }
}

/** Free all cached encoders. Call on process exit for clean shutdown. */
export function freeEncoders(): void {
  for (const enc of encoderCache.values()) {
    enc.free();
  }
  encoderCache.clear();
}

/** Check if a model ID is known to tiktoken (OpenAI native support). */
function isTiktokenNativeModel(modelId: string): boolean {
  try {
    // This also populates the cache, so the subsequent encode call is free
    getEncoderForModel(modelId);
    // If getEncoderForModel didn't throw and the model-specific key exists,
    // it's a native model. If it fell back to cl100k_base, it's not.
    return encoderCache.has(`model:${modelId}`);
  } catch {
    return false;
  }
}

/**
 * Count tokens for a given text using the appropriate tokenizer for the provider/model.
 *
 * - OpenAI models: tiktoken with native model encoding
 * - Anthropic models: cl100k_base approximation (±5%)
 * - Google models: cl100k_base approximation
 * - xAI / unknown: cl100k_base approximation
 */
export function countTokens(provider: Provider, modelId: string, text: string): number {
  if (text.length === 0) return 0;

  switch (provider) {
    case "openai":
      return countOpenAiTokens(modelId, text);
    case "anthropic":
      return countWithCl100k(text);
    case "google":
      return countGoogleTokens(text);
    case "xai":
    case "perplexity":
      return countWithCl100k(text);
    default: {
      const _exhaustive: never = provider;
      return countWithCl100k(text);
    }
  }
}

function countOpenAiTokens(modelId: string, text: string): number {
  if (isTiktokenNativeModel(modelId)) {
    const enc = getEncoderForModel(modelId);
    return enc.encode(text).length;
  }
  // Unknown OpenAI model — fall back to cl100k
  return countWithCl100k(text);
}

function countGoogleTokens(text: string): number {
  return countWithCl100k(text);
}

function countWithCl100k(text: string): number {
  return getEncoderByName("cl100k_base").encode(text).length;
}

/**
 * Count tokens for a full LLM message (system + user prompts combined).
 * Adds a small overhead for message formatting tokens.
 */
export function countMessageTokens(
  provider: Provider,
  modelId: string,
  params: { system?: string; user?: string },
): number {
  const { system = "", user = "" } = params;
  const systemTokens = system ? countTokens(provider, modelId, system) : 0;
  const userTokens = user ? countTokens(provider, modelId, user) : 0;
  // ~4 tokens overhead for message format (role, separators)
  const overhead = (system ? 4 : 0) + (user ? 4 : 0);
  return systemTokens + userTokens + overhead;
}
