import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAnthropicUsage } from "./anthropic.js";

describe("fetchAnthropicUsage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when ANTHROPIC_ADMIN_API_KEY is not set", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "");
    const result = await fetchAnthropicUsage(30);
    expect(result).toBeNull();
  });

  it("parses valid response and aggregates by model", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "sk-ant-admin-test");

    const mockResponse = {
      data: [
        {
          model: "claude-sonnet-4-20250514",
          input_tokens: 10000,
          output_tokens: 5000,
          num_requests: 100,
        },
        {
          model: "claude-sonnet-4-20250514",
          input_tokens: 20000,
          output_tokens: 10000,
          num_requests: 200,
        },
        {
          model: "claude-haiku-3-5-20241022",
          input_tokens: 5000,
          output_tokens: 2000,
          num_requests: 50,
        },
      ],
      has_more: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await fetchAnthropicUsage(30);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("anthropic");
    expect(result?.records).toHaveLength(2);

    const sonnet = result?.records.find((r) => r.model === "claude-sonnet-4-20250514");
    expect(sonnet?.requestCount).toBe(300);
    expect(sonnet?.totalInputTokens).toBe(30000);
    expect(sonnet?.totalOutputTokens).toBe(15000);
    expect(sonnet?.avgInputTokens).toBe(100);
    expect(sonnet?.avgOutputTokens).toBe(50);
  });

  it("throws on non-ok response", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "sk-ant-admin-test");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(fetchAnthropicUsage(30)).rejects.toThrow("401");
  });

  it("paginates through multiple pages", async () => {
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "sk-ant-admin-test");

    const page1 = {
      data: [
        {
          model: "claude-sonnet-4-20250514",
          input_tokens: 10000,
          output_tokens: 5000,
          num_requests: 100,
        },
      ],
      has_more: true,
      next_page: "page2token",
    };
    const page2 = {
      data: [
        {
          model: "claude-sonnet-4-20250514",
          input_tokens: 20000,
          output_tokens: 10000,
          num_requests: 200,
        },
      ],
      has_more: false,
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const result = await fetchAnthropicUsage(30);
    expect(result?.records).toHaveLength(1);
    expect(result?.records[0]?.requestCount).toBe(300);
  });
});
