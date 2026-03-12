/**
 * End-to-end tests for OTel telemetry integration.
 *
 * Exercises the full pipeline: scan fixtures → fetch production stats from
 * mocked OTel backends → build estimates with "production" source tokens.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEstimateRows } from "../estimate-core.js";
import { scanDirectory } from "../scanners/index.js";
import type { TelemetryConfig } from "../telemetry-client.js";
import { fetchProductionStats } from "../telemetry-client.js";

describe("OTel integration e2e", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-otel-e2e-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -- Fixtures --

  const MULTI_PROVIDER_APP = `
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const anthropic = new Anthropic();
const openai = new OpenAI();

// Anthropic call — dynamic prompt
const chatResponse = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 2048,
  messages: [{ role: "user", content: userInput }],
});

// OpenAI call — dynamic prompt
const summary = await openai.chat.completions.create({
  model: "gpt-4o",
  max_tokens: 1024,
  messages: [{ role: "user", content: document }],
});
`;

  const GOOGLE_AND_XAI_APP = `
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const gemini = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const result = await gemini.generateContent("Summarize this document");
`;

  // -- Grafana Tempo backend e2e --

  describe("Grafana Tempo backend", () => {
    it("full pipeline: scan → fetch Tempo traces → estimate with production stats", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), MULTI_PROVIDER_APP);

      // 1. Scan the fixture
      const scanResults = await scanDirectory(tmpDir);
      expect(scanResults.length).toBe(2);

      const anthropicCall = scanResults.find((r) => r.provider === "anthropic");
      const openaiCall = scanResults.find((r) => r.provider === "openai");
      expect(anthropicCall?.model).toBe("claude-sonnet-4-20250514");
      expect(openaiCall?.model).toBe("gpt-4o");

      // 2. Mock Tempo response with realistic production data
      // Need ≥10 spans per model for production stats to be used (threshold in resolveInputTokens)
      const anthropicSpans = Array.from({ length: 10 }, (_, i) => ({
        attributes: {
          "gen_ai.provider.name": "anthropic",
          "gen_ai.request.model": "claude-sonnet-4-20250514",
          "gen_ai.usage.input_tokens": 900 + i * 20, // avg ≈ 1000
          "gen_ai.usage.output_tokens": 350 + i * 10, // avg ≈ 400
        },
      }));
      const openaiSpans = Array.from({ length: 12 }, (_, i) => ({
        attributes: {
          "gen_ai.provider.name": "openai",
          "gen_ai.response.model": "gpt-4o",
          "gen_ai.usage.input_tokens": 3500 + i * 100, // avg ≈ 4050
          "gen_ai.usage.output_tokens": 400 + i * 20, // avg ≈ 510
        },
      }));
      const tempoResponse = {
        traces: [{ spans: anthropicSpans }, { spans: openaiSpans }],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(tempoResponse), { status: 200 }),
      );

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
        apiKey: "glsa_test",
      };

      const statsMap = await fetchProductionStats(config, 7);
      expect(statsMap).not.toBeNull();

      // Verify stats match our mock data
      const anthropicStats = statsMap?.get("anthropic/claude-sonnet-4-20250514");
      expect(anthropicStats?.request_count).toBe(10);
      expect(anthropicStats?.avg_input_tokens).toBeGreaterThan(900);
      expect(anthropicStats?.avg_input_tokens).toBeLessThan(1100);

      const openaiStats = statsMap?.get("openai/gpt-4o");
      expect(openaiStats?.request_count).toBe(12);
      expect(openaiStats?.avg_input_tokens).toBeGreaterThan(3500);
      expect(openaiStats?.avg_input_tokens).toBeLessThan(4200);

      // 3. Build estimates using production stats
      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, statsMap, null);
      expect(rows.length).toBe(2);

      // Anthropic call: max_tokens=2048 is code-extracted for output, production for input
      const anthropicRow = rows.find((r) => r.provider === "anthropic");
      expect(anthropicRow?.inputTokenSource).toBe("production");
      expect(anthropicRow?.inputTokens).toBeGreaterThan(900);
      expect(anthropicRow?.inputTokens).toBeLessThan(1100);
      // Output uses code source (max_tokens=2048) which takes priority over production
      expect(anthropicRow?.outputTokenSource).toBe("code");
      expect(anthropicRow?.outputTokens).toBe(2048);

      // OpenAI call: max_tokens=1024 code-extracted for output, production for input
      const openaiRow = rows.find((r) => r.provider === "openai");
      expect(openaiRow?.inputTokenSource).toBe("production");
      expect(openaiRow?.inputTokens).toBeGreaterThan(3500);
      expect(openaiRow?.inputTokens).toBeLessThan(4200);
      expect(openaiRow?.outputTokenSource).toBe("code");
      expect(openaiRow?.outputTokens).toBe(1024);
    });

    it("production stats override typical heuristics for dynamic prompts", async () => {
      // File with no static prompts and no max_tokens — everything is dynamic
      await writeFile(
        path.join(tmpDir, "dynamic.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: userQuery }],
        });\n`,
      );

      const scanResults = await scanDirectory(tmpDir);
      expect(scanResults.length).toBe(1);

      // Without production stats: typical heuristics
      const { rows: typicalRows } = buildEstimateRows(scanResults, {}, 1000, false, null, null);
      expect(typicalRows[0]?.inputTokenSource).toBe("typical");
      expect(typicalRows[0]?.outputTokenSource).toBe("typical");

      // With production stats from OTel
      const statsMap = new Map([
        [
          "anthropic/claude-sonnet-4-20250514",
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 500,
            avg_input_tokens: 850,
            avg_output_tokens: 200,
            p50_input_tokens: 700,
            p50_output_tokens: 180,
            avg_cost_per_request: 0,
            total_cost: 0,
          },
        ],
      ]);

      const { rows: productionRows } = buildEstimateRows(
        scanResults,
        {},
        1000,
        false,
        statsMap,
        null,
      );

      expect(productionRows[0]?.inputTokenSource).toBe("production");
      expect(productionRows[0]?.inputTokens).toBe(850);
      expect(productionRows[0]?.outputTokenSource).toBe("production");
      expect(productionRows[0]?.outputTokens).toBe(200);

      // Production stats should give lower costs than typical heuristics (4096 input, ~800 output)
      expect(productionRows[0]?.costPerCall).toBeLessThan(typicalRows[0]?.costPerCall ?? 0);
    });

    it("handles Tempo backend with multi-tenant headers", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), MULTI_PROVIDER_APP);

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ traces: [] }), { status: 200 }));

      const config: TelemetryConfig = {
        backend: "grafana-tempo",
        endpoint: "https://tempo.grafana.net",
        headers: { "X-Scope-OrgID": "team-platform" },
        apiKey: "glsa_production_key",
      };

      await fetchProductionStats(config, 30);

      // Verify correct headers were sent
      const callHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(callHeaders["X-Scope-OrgID"]).toBe("team-platform");
      expect(callHeaders.Authorization).toBe("Bearer glsa_production_key");

      // Verify Tempo search URL is well-formed
      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("/api/search");
      expect(url).toContain("tags=gen_ai.provider.name");
    });
  });

  // -- OTLP/Prometheus backend e2e --

  describe("OTLP Prometheus backend", () => {
    it("full pipeline: scan → query Prometheus → estimate with production stats", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), MULTI_PROVIDER_APP);

      const scanResults = await scanDirectory(tmpDir);
      expect(scanResults.length).toBe(2);

      // Mock three Prometheus queries (input sum, output sum, request count)
      const mkResult = (provider: string, model: string, value: string) => ({
        metric: { gen_ai_provider_name: provider, gen_ai_request_model: model },
        value: [1710000000, value],
      });

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "success",
              data: {
                resultType: "vector",
                result: [
                  mkResult("anthropic", "claude-sonnet-4-20250514", "500000"),
                  mkResult("openai", "gpt-4o", "800000"),
                ],
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "success",
              data: {
                resultType: "vector",
                result: [
                  mkResult("anthropic", "claude-sonnet-4-20250514", "200000"),
                  mkResult("openai", "gpt-4o", "300000"),
                ],
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "success",
              data: {
                resultType: "vector",
                result: [
                  mkResult("anthropic", "claude-sonnet-4-20250514", "500"),
                  mkResult("openai", "gpt-4o", "400"),
                ],
              },
            }),
            { status: 200 },
          ),
        );

      const config: TelemetryConfig = {
        backend: "otlp",
        endpoint: "https://prometheus.internal:9090",
      };

      const statsMap = await fetchProductionStats(config, 30);
      expect(statsMap).not.toBeNull();
      expect(statsMap?.size).toBe(2);

      // anthropic: 500000/500 = 1000 avg input, 200000/500 = 400 avg output
      const anthropicStats = statsMap?.get("anthropic/claude-sonnet-4-20250514");
      expect(anthropicStats?.avg_input_tokens).toBe(1000);
      expect(anthropicStats?.avg_output_tokens).toBe(400);

      // openai: 800000/400 = 2000 avg input, 300000/400 = 750 avg output
      const openaiStats = statsMap?.get("openai/gpt-4o");
      expect(openaiStats?.avg_input_tokens).toBe(2000);
      expect(openaiStats?.avg_output_tokens).toBe(750);

      // Build rows with production data
      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, statsMap, null);

      // max_tokens are code-extracted, so output stays "code" source
      // input has no static prompt, so production stats take over
      const anthropicRow = rows.find((r) => r.provider === "anthropic");
      expect(anthropicRow?.inputTokenSource).toBe("production");
      expect(anthropicRow?.inputTokens).toBe(1000);

      const openaiRow = rows.find((r) => r.provider === "openai");
      expect(openaiRow?.inputTokenSource).toBe("production");
      expect(openaiRow?.inputTokens).toBe(2000);
    });

    it("sends correct PromQL queries with days parameter", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ status: "success", data: { resultType: "vector", result: [] } }),
              { status: 200 },
            ),
        );

      const config: TelemetryConfig = {
        backend: "otlp",
        endpoint: "https://prom.internal:9090",
      };

      await fetchProductionStats(config, 14);

      // Should have made exactly 3 parallel queries
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const urls = fetchSpy.mock.calls.map((c) => c[0] as string);

      // Check that queries reference the correct time range
      expect(urls[0]).toContain("gen_ai_client_token_usage_sum");
      expect(urls[0]).toContain("input");
      expect(urls[0]).toContain("14d");

      expect(urls[1]).toContain("gen_ai_client_token_usage_sum");
      expect(urls[1]).toContain("output");
      expect(urls[1]).toContain("14d");

      expect(urls[2]).toContain("gen_ai_client_token_usage_count");
      expect(urls[2]).toContain("14d");
    });
  });

  // -- Legacy Inferwise Cloud backend e2e --

  describe("Legacy Inferwise Cloud backend", () => {
    it("full pipeline: scan → fetch from /v1/stats → estimate with production stats", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), MULTI_PROVIDER_APP);

      const scanResults = await scanDirectory(tmpDir);

      // Mock Inferwise Cloud API response
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              {
                provider: "anthropic",
                model: "claude-sonnet-4-20250514",
                request_count: 10000,
                avg_input_tokens: 1500,
                avg_output_tokens: 300,
                p50_input_tokens: 1200,
                p50_output_tokens: 250,
                avg_cost_per_request: 0.009,
                total_cost: 90,
              },
              {
                provider: "openai",
                model: "gpt-4o",
                request_count: 5000,
                avg_input_tokens: 2500,
                avg_output_tokens: 500,
                p50_input_tokens: 2000,
                p50_output_tokens: 400,
                avg_cost_per_request: 0.02,
                total_cost: 100,
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const config: TelemetryConfig = {
        backend: "inferwise-cloud",
        endpoint: "https://api.inferwise.dev",
        apiKey: "iw_test_key",
      };

      const statsMap = await fetchProductionStats(config);
      expect(statsMap?.size).toBe(2);

      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, statsMap, null);

      const anthropicRow = rows.find((r) => r.provider === "anthropic");
      expect(anthropicRow?.inputTokenSource).toBe("production");
      expect(anthropicRow?.inputTokens).toBe(1500);

      const openaiRow = rows.find((r) => r.provider === "openai");
      expect(openaiRow?.inputTokenSource).toBe("production");
      expect(openaiRow?.inputTokens).toBe(2500);
    });
  });

  // -- Source priority e2e --

  describe("token source priority", () => {
    it("code-extracted prompts take priority over production stats", async () => {
      // File with a static system prompt
      await writeFile(
        path.join(tmpDir, "static.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "You are a helpful coding assistant.",
          messages: [{ role: "user", content: "Hello" }],
        });\n`,
      );

      const scanResults = await scanDirectory(tmpDir);
      expect(scanResults.length).toBe(1);
      expect(scanResults[0]?.systemPrompt).toBeTruthy();

      // Production stats say avg input is 5000 tokens
      const statsMap = new Map([
        [
          "anthropic/claude-sonnet-4-20250514",
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 1000,
            avg_input_tokens: 5000,
            avg_output_tokens: 1000,
            p50_input_tokens: 4500,
            p50_output_tokens: 900,
            avg_cost_per_request: 0,
            total_cost: 0,
          },
        ],
      ]);

      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, statsMap, null);

      // Code-extracted takes priority: should be "code" source, NOT 5000 (production)
      expect(rows[0]?.inputTokenSource).toBe("code");
      expect(rows[0]?.inputTokens).toBeLessThan(5000);

      // Output: max_tokens=1024 code-extracted, not 1000 production
      expect(rows[0]?.outputTokenSource).toBe("code");
      expect(rows[0]?.outputTokens).toBe(1024);
    });

    it("production stats require ≥10 requests to be used", async () => {
      await writeFile(
        path.join(tmpDir, "dynamic.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: query }],
        });\n`,
      );

      const scanResults = await scanDirectory(tmpDir);

      // Only 5 requests — below the threshold
      const lowSampleStats = new Map([
        [
          "anthropic/claude-sonnet-4-20250514",
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 5,
            avg_input_tokens: 900,
            avg_output_tokens: 200,
            p50_input_tokens: 800,
            p50_output_tokens: 180,
            avg_cost_per_request: 0,
            total_cost: 0,
          },
        ],
      ]);

      const { rows: lowRows } = buildEstimateRows(
        scanResults,
        {},
        1000,
        false,
        lowSampleStats,
        null,
      );

      // Should fall back to typical (not production) since sample size < 10
      expect(lowRows[0]?.inputTokenSource).toBe("typical");
      expect(lowRows[0]?.outputTokenSource).toBe("typical");

      // 10+ requests — should use production
      const highSampleStats = new Map([
        [
          "anthropic/claude-sonnet-4-20250514",
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 10,
            avg_input_tokens: 900,
            avg_output_tokens: 200,
            p50_input_tokens: 800,
            p50_output_tokens: 180,
            avg_cost_per_request: 0,
            total_cost: 0,
          },
        ],
      ]);

      const { rows: highRows } = buildEstimateRows(
        scanResults,
        {},
        1000,
        false,
        highSampleStats,
        null,
      );

      expect(highRows[0]?.inputTokenSource).toBe("production");
      expect(highRows[0]?.inputTokens).toBe(900);
      expect(highRows[0]?.outputTokenSource).toBe("production");
      expect(highRows[0]?.outputTokens).toBe(200);
    });
  });
});
