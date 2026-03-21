import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryConfig } from "./telemetry-client.js";
import { buildLegacyTelemetryConfig, fetchProductionStats } from "./telemetry-client.js";

describe("telemetry-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildLegacyTelemetryConfig", () => {
    it("creates an inferwise-cloud config from apiUrl and apiKey", () => {
      const config = buildLegacyTelemetryConfig("https://api.inferwise.dev", "key-123");
      expect(config.backend).toBe("inferwise-cloud");
      expect(config.endpoint).toBe("https://api.inferwise.dev");
      expect(config.apiKey).toBe("key-123");
    });
  });

  describe("fetchProductionStats — inferwise-cloud backend", () => {
    it("fetches from /v1/stats endpoint", async () => {
      const mockResponse = {
        models: [
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 500,
            avg_input_tokens: 2000,
            avg_output_tokens: 800,
            p50_input_tokens: 1500,
            p50_output_tokens: 600,
            avg_cost_per_request: 0.021,
            total_cost: 10.5,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "inferwise-cloud",
        endpoint: "https://api.inferwise.dev",
        apiKey: "test-key",
      };

      const result = await fetchProductionStats(config);
      expect(result).not.toBeNull();
      expect(result?.get("anthropic/claude-sonnet-4-20250514")).toMatchObject({
        request_count: 500,
        avg_input_tokens: 2000,
      });
    });

    it("returns null on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Server Error", { status: 500 }),
      );

      const config: TelemetryConfig = {
        backend: "inferwise-cloud",
        endpoint: "https://api.inferwise.dev",
        apiKey: "test-key",
      };

      const result = await fetchProductionStats(config);
      expect(result).toBeNull();
    });

    it("returns null on invalid JSON schema", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ bad: "data" }), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "inferwise-cloud",
        endpoint: "https://api.inferwise.dev",
        apiKey: "test-key",
      };

      const result = await fetchProductionStats(config);
      expect(result).toBeNull();
    });
  });

  describe("fetchProductionStats — grafana-tempo backend", () => {
    it("queries Tempo search API and aggregates spans", async () => {
      const mockTempoResponse = {
        traces: [
          {
            spans: [
              {
                attributes: {
                  "gen_ai.provider.name": "anthropic",
                  "gen_ai.request.model": "claude-sonnet-4-20250514",
                  "gen_ai.usage.input_tokens": 3000,
                  "gen_ai.usage.output_tokens": 1200,
                },
              },
              {
                attributes: {
                  "gen_ai.provider.name": "anthropic",
                  "gen_ai.request.model": "claude-sonnet-4-20250514",
                  "gen_ai.usage.input_tokens": 5000,
                  "gen_ai.usage.output_tokens": 800,
                },
              },
              {
                attributes: {
                  "gen_ai.provider.name": "openai",
                  "gen_ai.response.model": "gpt-4o",
                  "gen_ai.usage.input_tokens": 2000,
                  "gen_ai.usage.output_tokens": 500,
                },
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockTempoResponse), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
        apiKey: "test-key",
      };

      const result = await fetchProductionStats(config, 7);
      expect(result).not.toBeNull();

      const anthropic = result?.get("anthropic/claude-sonnet-4-20250514");
      expect(anthropic?.request_count).toBe(2);
      expect(anthropic?.avg_input_tokens).toBe(4000);
      expect(anthropic?.avg_output_tokens).toBe(1000);

      const openai = result?.get("openai/gpt-4o");
      expect(openai?.request_count).toBe(1);
      expect(openai?.avg_input_tokens).toBe(2000);
    });

    it("prefers response.model over request.model", async () => {
      const mockResponse = {
        traces: [
          {
            spans: [
              {
                attributes: {
                  "gen_ai.provider.name": "openai",
                  "gen_ai.request.model": "gpt-4o",
                  "gen_ai.response.model": "gpt-4o-2024-08-06",
                  "gen_ai.usage.input_tokens": 1000,
                  "gen_ai.usage.output_tokens": 500,
                },
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
      };

      const result = await fetchProductionStats(config, 7);
      expect(result?.has("openai/gpt-4o-2024-08-06")).toBe(true);
      expect(result?.has("openai/gpt-4o")).toBe(false);
    });

    it("skips spans without provider or model", async () => {
      const mockResponse = {
        traces: [
          {
            spans: [
              { attributes: { "gen_ai.usage.input_tokens": 1000 } },
              {
                attributes: {
                  "gen_ai.provider.name": "anthropic",
                  "gen_ai.request.model": "claude-sonnet-4",
                  "gen_ai.usage.input_tokens": 2000,
                  "gen_ai.usage.output_tokens": 500,
                },
              },
            ],
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
      };

      const result = await fetchProductionStats(config, 7);
      expect(result?.size).toBe(1);
      expect(result?.has("anthropic/claude-sonnet-4")).toBe(true);
    });

    it("returns null when no traces found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ traces: [] }), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
      };

      const result = await fetchProductionStats(config, 7);
      expect(result).toBeNull();
    });

    it("throws on non-ok Tempo response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
      };

      await expect(fetchProductionStats(config, 7)).rejects.toThrow("502");
    });

    it("passes custom headers and auth", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ traces: [] }), { status: 200 }));

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
        headers: { "X-Scope-OrgID": "my-org" },
        apiKey: "glsa_test123",
      };

      await fetchProductionStats(config, 7);

      const callHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(callHeaders["X-Scope-OrgID"]).toBe("my-org");
      expect(callHeaders.Authorization).toBe("Bearer glsa_test123");
    });
  });

  describe("fetchProductionStats — otlp backend", () => {
    it("queries Prometheus for gen_ai metrics and merges results", async () => {
      const inputResponse = {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: {
                gen_ai_provider_name: "anthropic",
                gen_ai_request_model: "claude-sonnet-4",
              },
              value: [1710000000, "100000"],
            },
          ],
        },
      };

      const outputResponse = {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: {
                gen_ai_provider_name: "anthropic",
                gen_ai_request_model: "claude-sonnet-4",
              },
              value: [1710000000, "40000"],
            },
          ],
        },
      };

      const countResponse = {
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: {
                gen_ai_provider_name: "anthropic",
                gen_ai_request_model: "claude-sonnet-4",
              },
              value: [1710000000, "50"],
            },
          ],
        },
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(inputResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(outputResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(countResponse), { status: 200 }));

      const config: TelemetryConfig = {
        backend: "otlp",
        endpoint: "https://prometheus.internal:9090",
      };

      const result = await fetchProductionStats(config, 30);
      expect(result).not.toBeNull();

      const stats = result?.get("anthropic/claude-sonnet-4");
      expect(stats?.request_count).toBe(50);
      expect(stats?.avg_input_tokens).toBe(2000);
      expect(stats?.avg_output_tokens).toBe(800);
    });

    it("returns null when all queries return empty results", async () => {
      const emptyResponse = {
        status: "success",
        data: { resultType: "vector", result: [] },
      };

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(emptyResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(emptyResponse), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(emptyResponse), { status: 200 }));

      const config: TelemetryConfig = {
        backend: "otlp",
        endpoint: "https://prometheus.internal:9090",
      };

      const result = await fetchProductionStats(config, 30);
      expect(result).toBeNull();
    });

    it("handles Prometheus query failures gracefully", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response("error", { status: 500 }))
        .mockResolvedValueOnce(new Response("error", { status: 500 }));

      const config: TelemetryConfig = {
        backend: "otlp",
        endpoint: "https://prometheus.internal:9090",
      };

      const result = await fetchProductionStats(config, 30);
      expect(result).toBeNull();
    });
  });
});
