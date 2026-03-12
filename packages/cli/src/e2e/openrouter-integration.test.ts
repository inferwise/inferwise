/**
 * End-to-end tests for OpenRouter calibration integration.
 *
 * Exercises the full pipeline: scan fixtures → fetch OpenRouter usage →
 * compute calibration ratios → apply calibration to future estimates.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationData } from "../calibration.js";
import { computeModelCalibration } from "../calibration.js";
import { buildEstimateRows, typicalInputTokens, typicalOutputTokens } from "../estimate-core.js";
import { fetchOpenRouterUsage } from "../providers/openrouter.js";
import { scanDirectory } from "../scanners/index.js";

describe("OpenRouter calibration e2e", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-openrouter-e2e-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // -- Fixtures --

  const MULTI_PROVIDER_APP = `
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const anthropic = new Anthropic();
const openai = new OpenAI();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Anthropic
const chat = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: query }],
});

// OpenAI
const summary = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: doc }],
});

// Google
const gemini = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const result = await gemini.generateContent(prompt);
`;

  // -- Full calibration pipeline --

  describe("full calibration pipeline", () => {
    it("scan → fetch OpenRouter usage → compute calibration → apply to estimates", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
      await writeFile(path.join(tmpDir, "app.ts"), MULTI_PROVIDER_APP);

      // 1. Scan the fixture
      const scanResults = await scanDirectory(tmpDir);
      expect(scanResults.length).toBe(3);

      const providers = new Set(scanResults.map((r) => r.provider));
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("google");

      // 2. Mock OpenRouter activity API response
      const openRouterResponse = {
        data: [
          {
            date: "2026-03-12",
            model: "anthropic/claude-sonnet-4-20250514",
            model_permaslug: "anthropic/claude-sonnet-4-20250514",
            provider_name: "Anthropic",
            usage: 2.5,
            requests: 500,
            prompt_tokens: 400000,
            completion_tokens: 150000,
            reasoning_tokens: 0,
          },
          {
            date: "2026-03-12",
            model: "openai/gpt-4o",
            model_permaslug: "openai/gpt-4o",
            provider_name: "OpenAI",
            usage: 1.8,
            requests: 300,
            prompt_tokens: 600000,
            completion_tokens: 120000,
            reasoning_tokens: 30000,
          },
          {
            date: "2026-03-12",
            model: "google/gemini-2.5-flash",
            model_permaslug: "google/gemini-2.5-flash",
            provider_name: "Google AI Studio",
            usage: 0.5,
            requests: 1000,
            prompt_tokens: 200000,
            completion_tokens: 80000,
            reasoning_tokens: 0,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(openRouterResponse), { status: 200 }),
      );

      const usageResults = await fetchOpenRouterUsage(1);
      expect(usageResults).not.toBeNull();

      // Should cover all 3 providers
      const coveredProviders = new Set(usageResults?.map((r) => r.provider));
      expect(coveredProviders).toContain("anthropic");
      expect(coveredProviders).toContain("openai");
      expect(coveredProviders).toContain("google");

      // Verify OpenRouter data was correctly aggregated
      const anthropicUsage = usageResults?.find((r) => r.provider === "anthropic");
      const sonnetRecord = anthropicUsage?.records.find(
        (r) => r.model === "claude-sonnet-4-20250514",
      );
      expect(sonnetRecord?.requestCount).toBe(500);
      expect(sonnetRecord?.avgInputTokens).toBe(800); // 400000/500
      expect(sonnetRecord?.avgOutputTokens).toBe(300); // 150000/500

      // 3. Compute calibration ratios (simulating what calibrate command does)
      // Estimated values come from typical heuristics for dynamic prompts
      const { getModel } = await import("@inferwise/pricing-db");
      const sonnetPricing = getModel("anthropic", "claude-sonnet-4-20250514");
      const estInput = sonnetPricing ? typicalInputTokens(sonnetPricing) : 4096;
      const estOutput = sonnetPricing ? typicalOutputTokens(sonnetPricing) : 512;

      const sonnetCal = computeModelCalibration(
        estInput,
        estOutput,
        sonnetRecord?.avgInputTokens ?? 0,
        sonnetRecord?.avgOutputTokens ?? 0,
        sonnetRecord?.requestCount ?? 0,
      );

      // Calibration ratio: actual / estimated
      expect(sonnetCal.inputRatio).toBeGreaterThan(0);
      expect(sonnetCal.inputRatio).toBeLessThan(1); // 800/4096 ≈ 0.2 — actual is less than typical
      expect(sonnetCal.confidence).toBe("medium"); // 500 requests = medium

      // 4. Apply calibration to estimate rows
      const calibrationData: CalibrationData = {
        version: 1,
        calibratedAt: new Date().toISOString(),
        models: {
          "anthropic/claude-sonnet-4-20250514": sonnetCal,
        },
      };

      // Estimate without calibration
      const { rows: uncalibrated } = buildEstimateRows(scanResults, {}, 1000, false, null, null);

      // Estimate with calibration
      const { rows: calibrated } = buildEstimateRows(
        scanResults,
        {},
        1000,
        false,
        null,
        calibrationData,
      );

      const uncalAnthropicRow = uncalibrated.find((r) => r.provider === "anthropic");
      const calAnthropicRow = calibrated.find((r) => r.provider === "anthropic");

      // Calibrated input should be lower (actual usage was lower than typical)
      expect(calAnthropicRow?.inputTokenSource).toBe("calibrated");
      expect(calAnthropicRow?.inputTokens).toBeLessThan(uncalAnthropicRow?.inputTokens ?? 0);

      // Monthly cost should be lower with calibration
      expect(calAnthropicRow?.monthlyCost).toBeLessThan(uncalAnthropicRow?.monthlyCost ?? 0);
    });
  });

  // -- Cross-provider coverage --

  describe("cross-provider coverage via OpenRouter", () => {
    it("provides calibration data for Google (normally a stub)", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      const googleResponse = {
        data: [
          {
            date: "2026-03-12",
            model: "google/gemini-2.5-flash",
            model_permaslug: "google/gemini-2.5-flash",
            provider_name: "Google AI Studio",
            usage: 0.3,
            requests: 2000,
            prompt_tokens: 1000000,
            completion_tokens: 400000,
            reasoning_tokens: 0,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(googleResponse), { status: 200 }),
      );

      const results = await fetchOpenRouterUsage(1);
      expect(results).not.toBeNull();

      const googleResult = results?.find((r) => r.provider === "google");
      expect(googleResult).toBeDefined();
      expect(googleResult?.records.length).toBe(1);

      const flashRecord = googleResult?.records[0];
      expect(flashRecord?.model).toBe("gemini-2.5-flash");
      expect(flashRecord?.requestCount).toBe(2000);
      expect(flashRecord?.avgInputTokens).toBe(500); // 1000000/2000
      expect(flashRecord?.avgOutputTokens).toBe(200); // 400000/2000
    });

    it("provides calibration data for xAI (normally a stub)", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      const xaiResponse = {
        data: [
          {
            date: "2026-03-12",
            model: "xai/grok-3",
            model_permaslug: "xai/grok-3",
            provider_name: "xAI",
            usage: 1.0,
            requests: 100,
            prompt_tokens: 80000,
            completion_tokens: 30000,
            reasoning_tokens: 10000,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(xaiResponse), { status: 200 }),
      );

      const results = await fetchOpenRouterUsage(1);
      const xaiResult = results?.find((r) => r.provider === "xai");
      expect(xaiResult).toBeDefined();

      const grokRecord = xaiResult?.records[0];
      expect(grokRecord?.model).toBe("grok-3");
      expect(grokRecord?.requestCount).toBe(100);
      expect(grokRecord?.avgInputTokens).toBe(800);
      // Output includes reasoning tokens: (30000+10000)/100 = 400
      expect(grokRecord?.avgOutputTokens).toBe(400);
    });

    it("provides calibration data for Perplexity", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      const pplxResponse = {
        data: [
          {
            date: "2026-03-12",
            model: "perplexity/sonar-pro",
            model_permaslug: "perplexity/sonar-pro",
            provider_name: "Perplexity",
            usage: 0.2,
            requests: 50,
            prompt_tokens: 25000,
            completion_tokens: 10000,
            reasoning_tokens: 0,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(pplxResponse), { status: 200 }),
      );

      const results = await fetchOpenRouterUsage(1);
      const pplxResult = results?.find((r) => r.provider === "perplexity");
      expect(pplxResult).toBeDefined();
      expect(pplxResult?.records[0]?.model).toBe("sonar-pro");
    });
  });

  // -- Model ID mapping --

  describe("model ID mapping", () => {
    it("strips provider prefix from OpenRouter model IDs", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      const response = {
        data: [
          {
            date: "2026-03-12",
            model: "anthropic/claude-opus-4-20250514",
            model_permaslug: "anthropic/claude-opus-4-20250514",
            provider_name: "Anthropic",
            usage: 5.0,
            requests: 50,
            prompt_tokens: 100000,
            completion_tokens: 50000,
            reasoning_tokens: 0,
          },
          {
            date: "2026-03-12",
            model: "openai/o3",
            model_permaslug: "openai/o3",
            provider_name: "OpenAI",
            usage: 3.0,
            requests: 30,
            prompt_tokens: 60000,
            completion_tokens: 30000,
            reasoning_tokens: 15000,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(response), { status: 200 }),
      );

      const results = await fetchOpenRouterUsage(1);

      const anthropicResult = results?.find((r) => r.provider === "anthropic");
      expect(anthropicResult?.records[0]?.model).toBe("claude-opus-4-20250514");

      const openaiResult = results?.find((r) => r.provider === "openai");
      expect(openaiResult?.records[0]?.model).toBe("o3");
    });

    it("maps Google AI Studio and Vertex AI provider names correctly", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      const response = {
        data: [
          {
            date: "2026-03-12",
            model: "google/gemini-2.5-pro",
            model_permaslug: "google/gemini-2.5-pro",
            provider_name: "Google AI Studio",
            usage: 1.0,
            requests: 100,
            prompt_tokens: 50000,
            completion_tokens: 20000,
            reasoning_tokens: 0,
          },
          {
            date: "2026-03-12",
            model: "google/gemini-2.5-pro",
            model_permaslug: "google/gemini-2.5-pro",
            provider_name: "Vertex AI",
            usage: 0.5,
            requests: 50,
            prompt_tokens: 25000,
            completion_tokens: 10000,
            reasoning_tokens: 0,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => new Response(JSON.stringify(response), { status: 200 }),
      );

      const results = await fetchOpenRouterUsage(1);

      // Both Google AI Studio and Vertex AI should map to "google" provider
      const googleResult = results?.find((r) => r.provider === "google");
      expect(googleResult).toBeDefined();

      // Should be aggregated into a single record
      const proRecord = googleResult?.records.find((r) => r.model === "gemini-2.5-pro");
      expect(proRecord?.requestCount).toBe(150); // 100 + 50
      expect(proRecord?.totalInputTokens).toBe(75000); // 50000 + 25000
    });
  });

  // -- Multi-day aggregation --

  describe("multi-day aggregation", () => {
    it("aggregates usage across multiple days correctly", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        const dayData = {
          data: [
            {
              date: `2026-03-${12 - callCount + 1}`,
              model: "anthropic/claude-sonnet-4-20250514",
              model_permaslug: "anthropic/claude-sonnet-4-20250514",
              provider_name: "Anthropic",
              usage: 0.5,
              requests: 100,
              prompt_tokens: 50000 + callCount * 10000,
              completion_tokens: 20000,
              reasoning_tokens: 0,
            },
          ],
        };
        return new Response(JSON.stringify(dayData), { status: 200 });
      });

      const results = await fetchOpenRouterUsage(3);
      expect(results).not.toBeNull();

      const anthropicResult = results?.find((r) => r.provider === "anthropic");
      const record = anthropicResult?.records[0];

      // 3 days × 100 requests = 300 total
      expect(record?.requestCount).toBe(300);

      // Total input = (50000+10000) + (50000+20000) + (50000+30000) = 210000
      expect(record?.totalInputTokens).toBe(210000);

      // Total output = 3 × 20000 = 60000
      expect(record?.totalOutputTokens).toBe(60000);

      // Averages
      expect(record?.avgInputTokens).toBe(700); // 210000/300
      expect(record?.avgOutputTokens).toBe(200); // 60000/300
    });
  });

  // -- Calibration + production stats interaction --

  describe("calibration and production stats interaction", () => {
    it("production stats take priority over calibration (both available)", async () => {
      await writeFile(
        path.join(tmpDir, "dynamic.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: query }],
        });\n`,
      );

      const scanResults = await scanDirectory(tmpDir);

      // Production stats from OTel
      const statsMap = new Map([
        [
          "anthropic/claude-sonnet-4-20250514",
          {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            request_count: 1000,
            avg_input_tokens: 900,
            avg_output_tokens: 200,
            p50_input_tokens: 800,
            p50_output_tokens: 180,
            avg_cost_per_request: 0,
            total_cost: 0,
          },
        ],
      ]);

      // Calibration data from OpenRouter
      const calibration: CalibrationData = {
        version: 1,
        calibratedAt: new Date().toISOString(),
        models: {
          "anthropic/claude-sonnet-4-20250514": computeModelCalibration(4096, 800, 600, 150, 500),
        },
      };

      // With both: production stats should win (higher priority in the resolve pipeline)
      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, statsMap, calibration);

      expect(rows[0]?.inputTokenSource).toBe("production");
      expect(rows[0]?.inputTokens).toBe(900);
      expect(rows[0]?.outputTokenSource).toBe("production");
      expect(rows[0]?.outputTokens).toBe(200);
    });

    it("calibration is used when production stats are unavailable", async () => {
      await writeFile(
        path.join(tmpDir, "dynamic.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          messages: [{ role: "user", content: query }],
        });\n`,
      );

      const scanResults = await scanDirectory(tmpDir);

      // Only calibration (no production stats)
      const calibration: CalibrationData = {
        version: 1,
        calibratedAt: new Date().toISOString(),
        models: {
          "anthropic/claude-sonnet-4-20250514": computeModelCalibration(4096, 800, 600, 150, 500),
        },
      };

      const { rows } = buildEstimateRows(scanResults, {}, 1000, false, null, calibration);

      expect(rows[0]?.inputTokenSource).toBe("calibrated");
      expect(rows[0]?.outputTokenSource).toBe("calibrated");
      // Calibrated tokens = typical * ratio
      // Input ratio = 600/4096 ≈ 0.146, so calibrated ≈ 4096 * 0.146 ≈ 599
      expect(rows[0]?.inputTokens).toBeLessThan(4096);
      expect(rows[0]?.inputTokens).toBeGreaterThan(0);
    });
  });
});
