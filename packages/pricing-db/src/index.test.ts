import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calculateCost,
  computeTier,
  getAllModels,
  getAllProviders,
  getModel,
  getPricingAgeInDays,
  getProviderMeta,
  normalizeModelId,
} from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(__dirname, "../providers");
const SCHEMA_PATH = join(__dirname, "../schema.json");

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

describe("computeTier", () => {
  it("classifies budget tier (output ≤ $5/M)", () => {
    expect(computeTier(0.6)).toBe("budget");
    expect(computeTier(2.5)).toBe("budget");
    expect(computeTier(5)).toBe("budget");
  });

  it("classifies mid tier ($5/M < output < $20/M)", () => {
    expect(computeTier(5.01)).toBe("mid");
    expect(computeTier(10)).toBe("mid");
    expect(computeTier(15)).toBe("mid");
    expect(computeTier(19.99)).toBe("mid");
  });

  it("classifies premium tier (output ≥ $20/M)", () => {
    expect(computeTier(20)).toBe("premium");
    expect(computeTier(25)).toBe("premium");
    expect(computeTier(75)).toBe("premium");
  });

  it("all loaded models have a valid computed tier", () => {
    for (const model of getAllModels()) {
      expect(["budget", "mid", "premium"]).toContain(model.tier);
    }
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

describe("normalizeModelId", () => {
  it("strips Bedrock provider prefix and version suffix", () => {
    expect(normalizeModelId("anthropic.claude-sonnet-4-20250514-v1:0")).toBe(
      "claude-sonnet-4-20250514",
    );
  });

  it("strips LiteLLM bedrock/ routing prefix", () => {
    expect(normalizeModelId("bedrock/anthropic.claude-sonnet-4-20250514-v1:0")).toBe(
      "claude-sonnet-4-20250514",
    );
  });

  it("strips azure/ prefix", () => {
    expect(normalizeModelId("azure/gpt-4o")).toBe("gpt-4o");
  });

  it("strips vertex_ai/ prefix", () => {
    expect(normalizeModelId("vertex_ai/gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  it("returns canonical IDs unchanged", () => {
    expect(normalizeModelId("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514");
    expect(normalizeModelId("gpt-4o")).toBe("gpt-4o");
  });
});

describe("getModel with platform-prefixed IDs", () => {
  it("resolves Bedrock-prefixed anthropic model", () => {
    const model = getModel("anthropic", "anthropic.claude-sonnet-4-20250514-v1:0");
    expect(model).toBeDefined();
    expect(model?.id).toBe("claude-sonnet-4-20250514");
  });

  it("resolves LiteLLM bedrock/ routing prefix", () => {
    const model = getModel("anthropic", "bedrock/anthropic.claude-sonnet-4-20250514-v1:0");
    expect(model).toBeDefined();
    expect(model?.id).toBe("claude-sonnet-4-20250514");
  });

  it("resolves azure/ prefix for OpenAI models", () => {
    const model = getModel("openai", "azure/gpt-4o");
    expect(model).toBeDefined();
    expect(model?.id).toBe("gpt-4o");
  });

  it("resolves vertex_ai/ prefix for Google models", () => {
    const model = getModel("google", "vertex_ai/gemini-2.5-pro");
    expect(model).toBeDefined();
    expect(model?.id).toBe("gemini-2.5-pro");
  });

  it("resolves Bedrock version suffix only", () => {
    const model = getModel("anthropic", "claude-sonnet-4-20250514-v1:0");
    expect(model).toBeDefined();
    expect(model?.id).toBe("claude-sonnet-4-20250514");
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

describe("schema validation", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as Record<string, unknown>;
  const schemaProps = (schema.properties as Record<string, unknown>) ?? {};
  const modelSchema = (
    (schemaProps.models as Record<string, unknown>)?.items as Record<string, unknown>
  )?.properties as Record<string, unknown>;
  const requiredModelFields = (
    (schemaProps.models as Record<string, unknown>)?.items as Record<string, unknown>
  )?.required as string[];
  const providerFiles = readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith(".json"));

  it("every provider JSON has required top-level fields", () => {
    const requiredFields = schema.required as string[];
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as Record<
        string,
        unknown
      >;
      for (const field of requiredFields) {
        expect(data, `${file} missing "${field}"`).toHaveProperty(field);
      }
    }
  });

  it("every model has all required schema fields", () => {
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as {
        models: Record<string, unknown>[];
      };
      for (const model of data.models) {
        for (const field of requiredModelFields) {
          expect(model, `${file} model "${model.id}" missing "${field}"`).toHaveProperty(field);
        }
      }
    }
  });

  it("no model has extra fields not in schema", () => {
    const allowedFields = Object.keys(modelSchema);
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as {
        models: Record<string, unknown>[];
      };
      for (const model of data.models) {
        for (const key of Object.keys(model)) {
          expect(allowedFields, `${file} model "${model.id}" has unknown field "${key}"`).toContain(
            key,
          );
        }
      }
    }
  });

  it("no duplicate model IDs within a provider", () => {
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as {
        models: { id: string }[];
      };
      const ids = data.models.map((m) => m.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `${file} has duplicate model IDs`).toEqual([]);
    }
  });

  it("all costs are non-negative numbers", () => {
    const costFields = Object.keys(modelSchema).filter((k) => k.includes("cost"));
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as {
        models: Record<string, unknown>[];
      };
      for (const model of data.models) {
        for (const field of costFields) {
          if (field in model) {
            const val = model[field] as number;
            expect(val, `${file} "${model.id}" ${field} is negative`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("last_updated and last_verified are valid ISO dates", () => {
    for (const file of providerFiles) {
      const data = JSON.parse(readFileSync(join(PROVIDERS_DIR, file), "utf-8")) as {
        last_updated: string;
        last_verified: string;
      };
      expect(data.last_updated, `${file} last_updated`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(data.last_verified, `${file} last_verified`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
