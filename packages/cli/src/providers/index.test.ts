import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_ENV_KEYS,
  SUPPORTED_PROVIDERS,
  fetchOpenRouterUsage,
  fetchProviderUsage,
} from "./index.js";

describe("PROVIDER_ENV_KEYS", () => {
  it("maps all supported providers to env var names", () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(PROVIDER_ENV_KEYS[provider]).toBeTruthy();
    }
  });

  it("anthropic uses admin key", () => {
    expect(PROVIDER_ENV_KEYS.anthropic).toBe("ANTHROPIC_ADMIN_API_KEY");
  });
});

describe("fetchProviderUsage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null for anthropic when env var is missing", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "");
    const result = await fetchProviderUsage("anthropic", 30);
    expect(result).toBeNull();
  });

  it("returns null for openai when env var is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await fetchProviderUsage("openai", 30);
    expect(result).toBeNull();
  });

  it("returns empty records for google (stub)", async () => {
    const result = await fetchProviderUsage("google", 30);
    expect(result).not.toBeNull();
    expect(result?.records).toEqual([]);
  });

  it("returns empty records for xai (stub)", async () => {
    const result = await fetchProviderUsage("xai", 30);
    expect(result).not.toBeNull();
    expect(result?.records).toEqual([]);
  });

  it("returns null for perplexity", async () => {
    const result = await fetchProviderUsage("perplexity", 30);
    expect(result).toBeNull();
  });
});

describe("fetchOpenRouterUsage export", () => {
  it("is exported from providers/index", () => {
    expect(typeof fetchOpenRouterUsage).toBe("function");
  });
});
