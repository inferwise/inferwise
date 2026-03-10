import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAIUsage } from "./openai.js";

describe("fetchOpenAIUsage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await fetchOpenAIUsage(30);
    expect(result).toBeNull();
  });

  it("parses valid response and aggregates by model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

    const mockResponse = {
      data: [
        { model: "gpt-4o", input_tokens: 50000, output_tokens: 20000, num_model_requests: 500 },
        { model: "gpt-4o", input_tokens: 30000, output_tokens: 10000, num_model_requests: 300 },
        {
          model: "gpt-4o-mini",
          input_tokens: 10000,
          output_tokens: 5000,
          num_model_requests: 1000,
        },
      ],
      has_more: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await fetchOpenAIUsage(30);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("openai");
    expect(result?.records).toHaveLength(2);

    const gpt4o = result?.records.find((r) => r.model === "gpt-4o");
    expect(gpt4o?.requestCount).toBe(800);
    expect(gpt4o?.totalInputTokens).toBe(80000);
    expect(gpt4o?.avgInputTokens).toBe(100);
  });

  it("throws on non-ok response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    await expect(fetchOpenAIUsage(30)).rejects.toThrow("403");
  });
});
