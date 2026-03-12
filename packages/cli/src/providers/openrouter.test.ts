import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterUsage } from "./openrouter.js";

describe("fetchOpenRouterUsage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when OPENROUTER_API_KEY is not set", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const result = await fetchOpenRouterUsage(30);
    expect(result).toBeNull();
  });

  it("parses activity response and groups by provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    const mockResponse = {
      data: [
        {
          date: "2026-03-12",
          model: "anthropic/claude-sonnet-4",
          model_permaslug: "anthropic/claude-sonnet-4",
          provider_name: "Anthropic",
          usage: 0.5,
          requests: 100,
          prompt_tokens: 50000,
          completion_tokens: 20000,
          reasoning_tokens: 0,
        },
        {
          date: "2026-03-12",
          model: "openai/gpt-4o",
          model_permaslug: "openai/gpt-4o",
          provider_name: "OpenAI",
          usage: 0.3,
          requests: 200,
          prompt_tokens: 80000,
          completion_tokens: 30000,
          reasoning_tokens: 5000,
        },
      ],
    };

    // Only one day fetched (days=1)
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const results = await fetchOpenRouterUsage(1);
    expect(results).not.toBeNull();
    expect(results).toHaveLength(2);

    const anthropicResult = results?.find((r) => r.provider === "anthropic");
    expect(anthropicResult).toBeDefined();
    expect(anthropicResult?.records).toHaveLength(1);
    expect(anthropicResult?.records[0]?.model).toBe("claude-sonnet-4");
    expect(anthropicResult?.records[0]?.requestCount).toBe(100);
    expect(anthropicResult?.records[0]?.avgInputTokens).toBe(500);

    const openaiResult = results?.find((r) => r.provider === "openai");
    expect(openaiResult).toBeDefined();
    expect(openaiResult?.records).toHaveLength(1);
    expect(openaiResult?.records[0]?.model).toBe("gpt-4o");
    expect(openaiResult?.records[0]?.requestCount).toBe(200);
    // Output includes reasoning tokens: 30000 + 5000 = 35000
    expect(openaiResult?.records[0]?.avgOutputTokens).toBe(175);
  });

  it("aggregates across multiple days", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    const day1 = {
      data: [
        {
          date: "2026-03-12",
          model: "anthropic/claude-sonnet-4",
          model_permaslug: "anthropic/claude-sonnet-4",
          provider_name: "Anthropic",
          usage: 0.2,
          requests: 50,
          prompt_tokens: 25000,
          completion_tokens: 10000,
          reasoning_tokens: 0,
        },
      ],
    };

    const day2 = {
      data: [
        {
          date: "2026-03-11",
          model: "anthropic/claude-sonnet-4",
          model_permaslug: "anthropic/claude-sonnet-4",
          provider_name: "Anthropic",
          usage: 0.3,
          requests: 50,
          prompt_tokens: 25000,
          completion_tokens: 10000,
          reasoning_tokens: 0,
        },
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(day1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(day2), { status: 200 }));

    const results = await fetchOpenRouterUsage(2);
    expect(results).not.toBeNull();

    const anthropicResult = results?.find((r) => r.provider === "anthropic");
    expect(anthropicResult?.records[0]?.requestCount).toBe(100);
    expect(anthropicResult?.records[0]?.totalInputTokens).toBe(50000);
    expect(anthropicResult?.records[0]?.avgInputTokens).toBe(500);
  });

  it("strips provider prefix from model IDs", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    const mockResponse = {
      data: [
        {
          date: "2026-03-12",
          model: "google/gemini-2.5-pro",
          model_permaslug: "google/gemini-2.5-pro",
          provider_name: "Google AI Studio",
          usage: 0.1,
          requests: 10,
          prompt_tokens: 5000,
          completion_tokens: 2000,
          reasoning_tokens: 0,
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const results = await fetchOpenRouterUsage(1);
    const googleResult = results?.find((r) => r.provider === "google");
    expect(googleResult?.records[0]?.model).toBe("gemini-2.5-pro");
  });

  it("throws on non-ok response", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(fetchOpenRouterUsage(1)).rejects.toThrow("401");
  });

  it("returns null when no activity data", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const result = await fetchOpenRouterUsage(1);
    expect(result).toBeNull();
  });

  it("skips records with unknown providers", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    const mockResponse = {
      data: [
        {
          date: "2026-03-12",
          model: "unknown-provider/some-model",
          model_permaslug: "unknown-provider/some-model",
          provider_name: "SomeUnknownProvider",
          usage: 0.1,
          requests: 10,
          prompt_tokens: 5000,
          completion_tokens: 2000,
          reasoning_tokens: 0,
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const results = await fetchOpenRouterUsage(1);
    // All records had unknown providers, so aggregation produces empty results
    expect(results).not.toBeNull();
    expect(results).toHaveLength(0);
  });

  it("caps days at 30", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await fetchOpenRouterUsage(90);
    // Should have made 30 calls (one per day), not 90
    expect(fetchSpy).toHaveBeenCalledTimes(30);
  });
});
