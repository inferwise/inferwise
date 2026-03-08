import type { Provider } from "@inferwise/pricing-db";
import { type Tiktoken, type TiktokenModel, encoding_for_model, get_encoding } from "tiktoken";

// Correction factor for Google models (cl100k_base underestimates)
const GOOGLE_CORRECTION_FACTOR = 1.1;

// Cache encoders — creating them is expensive (WASM init)
let cl100kEncoder: Tiktoken | null = null;

function getCl100kEncoder(): Tiktoken {
  if (!cl100kEncoder) {
    cl100kEncoder = get_encoding("cl100k_base");
  }
  return cl100kEncoder;
}

/** Free all cached encoders. Call on process exit for clean shutdown. */
export function freeEncoders(): void {
  if (cl100kEncoder) {
    cl100kEncoder.free();
    cl100kEncoder = null;
  }
}

/** Check if a model ID is known to tiktoken (OpenAI native support). */
function isTiktokenNativeModel(modelId: string): boolean {
  try {
    const enc = encoding_for_model(modelId as TiktokenModel);
    enc.free();
    return true;
  } catch {
    return false;
  }
}

/**
 * Count tokens for a given text using the appropriate tokenizer for the provider/model.
 *
 * - OpenAI models: tiktoken with native model encoding
 * - Anthropic models: cl100k_base approximation (±5%)
 * - Google models: cl100k_base + 1.1x correction factor
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
      return countWithCl100k(text);
    default: {
      const _exhaustive: never = provider;
      return countWithCl100k(text);
    }
  }
}

function countOpenAiTokens(modelId: string, text: string): number {
  if (isTiktokenNativeModel(modelId)) {
    // Use a fresh encoder per call for OpenAI models to avoid WASM state issues
    // across different model encodings (gpt-3.5 uses cl100k, gpt-4 uses o200k_base, etc.)
    const enc = encoding_for_model(modelId as TiktokenModel);
    const count = enc.encode(text).length;
    enc.free();
    return count;
  }
  // Unknown OpenAI model — fall back to cl100k
  return countWithCl100k(text);
}

function countGoogleTokens(text: string): number {
  const raw = countWithCl100k(text);
  return Math.ceil(raw * GOOGLE_CORRECTION_FACTOR);
}

function countWithCl100k(text: string): number {
  return getCl100kEncoder().encode(text).length;
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
