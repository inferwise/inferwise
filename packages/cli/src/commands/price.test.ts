import {
  calculateCost,
  getAllModels,
  getAllProviders,
  getModel,
  getProviderModels,
} from "@inferwise/pricing-db";
import { describe, expect, it } from "vitest";

describe("price command logic", () => {
  describe("provider resolution", () => {
    it("recognizes all supported providers", () => {
      const providers = getAllProviders();
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("google");
      expect(providers).toContain("xai");
      expect(providers).toContain("perplexity");
    });
  });

  describe("model lookup", () => {
    it("finds a known Anthropic model", () => {
      const model = getModel("anthropic", "claude-sonnet-4-20250514");
      expect(model).toBeDefined();
      expect(model?.input_cost_per_million).toBeGreaterThan(0);
      expect(model?.output_cost_per_million).toBeGreaterThan(0);
    });

    it("finds a known OpenAI model", () => {
      const model = getModel("openai", "gpt-4o");
      expect(model).toBeDefined();
      expect(model?.input_cost_per_million).toBeGreaterThan(0);
    });

    it("finds a known Google model", () => {
      const models = getProviderModels("google");
      expect(models.length).toBeGreaterThan(0);
      const gemini = models.find((m) => m.id.startsWith("gemini"));
      expect(gemini).toBeDefined();
    });

    it("returns undefined for an unknown model", () => {
      const model = getModel("anthropic", "claude-nonexistent-99");
      expect(model).toBeUndefined();
    });
  });

  describe("cost calculation", () => {
    it("computes standard cost correctly", () => {
      const model = getModel("anthropic", "claude-sonnet-4-20250514");
      expect(model).toBeDefined();
      if (!model) return;

      const cost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
      });
      expect(cost).toBeGreaterThan(0);
      // Verify calculation: (1000 * input_rate + 1000 * output_rate) / 1_000_000
      const expected =
        (1000 * model.input_cost_per_million + 1000 * model.output_cost_per_million) / 1_000_000;
      expect(cost).toBeCloseTo(expected, 6);
    });

    it("computes batch cost when available", () => {
      const model = getModel("anthropic", "claude-sonnet-4-20250514");
      expect(model).toBeDefined();
      if (!model || model.batch_input_cost_per_million === undefined) return;

      const batchCost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
        useBatch: true,
      });
      const standardCost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
      });

      // Batch should be cheaper than standard
      expect(batchCost).toBeLessThan(standardCost);
    });

    it("computes cached cost when available", () => {
      const model = getModel("anthropic", "claude-sonnet-4-20250514");
      expect(model).toBeDefined();
      if (!model || model.cache_read_input_cost_per_million === undefined) return;

      const cachedCost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
        cachedInputTokens: 1000,
      });
      const standardCost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
      });

      // Cached should be cheaper than standard
      expect(cachedCost).toBeLessThan(standardCost);
    });
  });

  describe("list models", () => {
    it("returns models for each provider", () => {
      for (const provider of getAllProviders()) {
        const models = getProviderModels(provider);
        expect(models.length).toBeGreaterThan(0);
      }
    });

    it("returns all models across providers", () => {
      const all = getAllModels();
      expect(all.length).toBeGreaterThan(30);
    });

    it("models have required pricing fields", () => {
      const all = getAllModels();
      for (const model of all) {
        expect(model.id).toBeTruthy();
        expect(model.input_cost_per_million).toBeGreaterThanOrEqual(0);
        expect(model.output_cost_per_million).toBeGreaterThanOrEqual(0);
        expect(model.context_window).toBeGreaterThan(0);
        expect(model.max_output_tokens).toBeGreaterThan(0);
      }
    });
  });

  describe("monthly projection", () => {
    it("scales linearly with volume", () => {
      const model = getModel("openai", "gpt-4o");
      if (!model) return;

      const cost = calculateCost({
        model,
        inputTokens: 1000,
        outputTokens: 1000,
      });

      const monthly100 = cost * 100 * 30;
      const monthly1000 = cost * 1000 * 30;

      expect(monthly1000 / monthly100).toBeCloseTo(10, 0);
    });
  });

  describe("compare mode", () => {
    it("can compare models across providers", () => {
      const sonnet = getModel("anthropic", "claude-sonnet-4-20250514");
      const gpt4o = getModel("openai", "gpt-4o");

      expect(sonnet).toBeDefined();
      expect(gpt4o).toBeDefined();

      if (!sonnet || !gpt4o) return;

      const sonnetCost = calculateCost({
        model: sonnet,
        inputTokens: 1000,
        outputTokens: 1000,
      });
      const gpt4oCost = calculateCost({
        model: gpt4o,
        inputTokens: 1000,
        outputTokens: 1000,
      });

      // Both should be positive
      expect(sonnetCost).toBeGreaterThan(0);
      expect(gpt4oCost).toBeGreaterThan(0);
    });
  });
});
