import type { Provider } from "@inferwise/pricing-db";
import { fetchAnthropicUsage } from "./anthropic.js";
import { fetchGoogleUsage } from "./google.js";
import { fetchOpenAIUsage } from "./openai.js";
import type { ProviderUsageResult } from "./types.js";
import { fetchXaiUsage } from "./xai.js";

export type { ProviderUsageRecord, ProviderUsageResult } from "./types.js";

const PROVIDER_FETCHERS: Record<Provider, (days: number) => Promise<ProviderUsageResult | null>> = {
  anthropic: fetchAnthropicUsage,
  openai: fetchOpenAIUsage,
  google: fetchGoogleUsage,
  xai: fetchXaiUsage,
  perplexity: async (_days: number) => null,
};

/** Env var names for each provider's usage API key. */
export const PROVIDER_ENV_KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_ADMIN_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  xai: "XAI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
};

/** Providers that have a real usage API (not stubs). */
export const SUPPORTED_PROVIDERS: Provider[] = ["anthropic", "openai"];

/**
 * Fetch actual usage data from a provider's API.
 * Returns null if the provider's env var is not set or the provider is unsupported.
 */
export async function fetchProviderUsage(
  provider: Provider,
  days: number,
): Promise<ProviderUsageResult | null> {
  const fetcher = PROVIDER_FETCHERS[provider];
  return fetcher(days);
}
