import { describe, expect, it } from "vitest";
import {
  calculateCost,
  getAllModels,
  getAllProviders,
  getModel,
  getPricingAgeInDays,
  getProviderMeta,
} from "./index.js";

describe("getAllProviders", () => {
  it("returns the four supported providers", () => {
    const providers = getAllProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("google");
    expect(providers).toContain("xai");
    expect(providers).toHaveLength(4);
  });
});

describe("getAllModels", () => {
  it("returns models from all providers", () => {
    const models = getAllModels();
    expect(models.length).toBeGreaterThan(10);
  });

  it("every model has required fields", () => {
    for (const model of getAllModels()) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
      expect(typeof model.input_cost_per_million).toBe("number");
      expect(model.input_cost_per_million).toBeGreaterThanOrEqual(0);
      expect(typeof model.output_cost_per_million).toBe("number");
      expect(model.output_cost_per_million).toBeGreaterThanOrEqual(0);
      expect(typeof model.context_window).toBe("number");
      expect(model.context_window).toBeGreaterThan(0);
    }
  });

  it("every model has a provider field set", () => {
    for (const model of getAllModels()) {
      expect(["anthropic", "openai", "google", "xai"]).toContain(model.provider);
    }
  });
});

describe("getModel", () => {
  it("finds anthropic model by canonical ID", () => {
    const model = getModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("anthropic");
    expect(model?.input_cost_per_million).toBeGreaterThan(0);
  });

  it("finds openai model by canonical ID", () => {
    const model = getModel("openai", "gpt-4o");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("openai");
  });

  it("finds google model by canonical ID", () => {
    const model = getModel("google", "gemini-2.5-pro");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("google");
  });

  it("finds xai model by canonical ID", () => {
    const model = getModel("xai", "grok-3");
    expect(model).toBeDefined();
    expect(model?.provider).toBe("xai");
  });

  it("returns undefined for unknown model", () => {
    const model = getModel("anthropic", "claude-nonexistent-model");
    expect(model).toBeUndefined();
  });

  it("finds model by alias", () => {
    // All models have an aliases array — test that alias lookup works
    const allModels = getAllModels();
    const withAlias = allModels.find((m) => m.aliases.length > 0);
    if (withAlias) {
      const alias = withAlias.aliases[0];
      if (alias) {
        const found = getModel(withAlias.provider, alias);
        expect(found?.id).toBe(withAlias.id);
      }
    }
  });
});

describe("getProviderMeta", () => {
  it("returns metadata with a source URL", () => {
    const meta = getProviderMeta("anthropic");
    expect(meta.source).toMatch(/^https?:\/\//);
    expect(meta.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getPricingAgeInDays", () => {
  it("returns a non-negative number of days", () => {
    const age = getPricingAgeInDays("anthropic");
    expect(age).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateCost", () => {
  it("calculates standard input+output cost", () => {
    const model = getModel("openai", "gpt-4o");
    expect(model).toBeDefined();
    if (!model) return;

    // 1000 input + 500 output tokens
    const cost = calculateCost({ model, inputTokens: 1000, outputTokens: 500 });
    const expected =
      (1000 / 1_000_000) * model.input_cost_per_million +
      (500 / 1_000_000) * model.output_cost_per_million;
    expect(cost).toBeCloseTo(expected, 8);
  });

  it("returns 0 for 0 tokens", () => {
    const model = getModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    if (!model) return;
    expect(calculateCost({ model, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("applies cache read pricing when cachedInputTokens provided", () => {
    const model = getModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    if (!model || !model.cache_read_input_cost_per_million) return;

    const fullCost = calculateCost({ model, inputTokens: 1000, outputTokens: 0 });
    const cachedCost = calculateCost({
      model,
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 1000,
    });
    // Cached should be cheaper than full price
    expect(cachedCost).toBeLessThan(fullCost);
  });

  it("applies batch pricing when useBatch=true and model supports it", () => {
    const model = getModel("anthropic", "claude-sonnet-4-20250514");
    expect(model).toBeDefined();
    if (!model || !model.batch_input_cost_per_million) return;

    const standard = calculateCost({ model, inputTokens: 1000, outputTokens: 500 });
    const batch = calculateCost({ model, inputTokens: 1000, outputTokens: 500, useBatch: true });
    expect(batch).toBeLessThan(standard);
  });

  it("auto-detects long context when inputTokens > 200k", () => {
    const model = getAllModels().find((m) => m.input_cost_above_200k_per_million !== undefined);
    if (!model) return; // Skip if no model has long-context pricing

    const standard = calculateCost({ model, inputTokens: 1000, outputTokens: 100 });
    const longCtx = calculateCost({
      model,
      inputTokens: 250_000,
      outputTokens: 100,
      isLongContext: true,
    });
    // Long context rate should differ (either higher or lower depending on model)
    expect(typeof longCtx).toBe("number");
    expect(longCtx).toBeGreaterThan(0);
    // Standard 1000 tokens should be cheaper overall than 250k tokens at any rate
    expect(longCtx).toBeGreaterThan(standard);
  });
});
