import { describe, expect, it } from "vitest";
import { handleEstimateCost } from "./tools/estimate-cost.js";
import { handleSuggestModel } from "./tools/suggest-model.js";

describe("suggest_model handler", () => {
  it("returns a model for a classification task", () => {
    const result = handleSuggestModel({ task: "classify customer support tickets" });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.recommended.model).toBeDefined();
    expect(result.recommended.provider).toBeDefined();
    expect(result.inferredCapabilities.length).toBeGreaterThan(0);
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it("returns a model with code capability for programming tasks", () => {
    const result = handleSuggestModel({ task: "debug this Python function" });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.inferredCapabilities).toContain("code");
  });

  it("respects provider constraint", () => {
    const result = handleSuggestModel({ task: "summarize a document", provider: "openai" });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.recommended.provider).toBe("openai");
  });

  it("returns alternatives alongside recommendation", () => {
    const result = handleSuggestModel({ task: "write some code" });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    // The cheapest model has no cheaper alternatives, but this verifies structure
    expect(Array.isArray(result.alternatives)).toBe(true);
  });
});

describe("estimate_cost handler", () => {
  it("returns cost for a known model", () => {
    const result = handleEstimateCost({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.costPerCall).toBeGreaterThan(0);
    expect(result.modelName).toBeDefined();
    expect(result.monthlyCost).toBeNull();
  });

  it("returns monthly projection when requestsPerDay provided", () => {
    const result = handleEstimateCost({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 4096,
      outputTokens: 1024,
      requestsPerDay: 1000,
    });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.monthlyCost).toBeGreaterThan(0);
    expect(result.requestsPerDay).toBe(1000);
  });

  it("returns error string for unknown provider", () => {
    const result = handleEstimateCost({
      provider: "nonexistent",
      model: "foo",
      inputTokens: 100,
      outputTokens: 100,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("Unknown provider");
  });

  it("returns error string for unknown model", () => {
    const result = handleEstimateCost({
      provider: "openai",
      model: "nonexistent-model",
      inputTokens: 100,
      outputTokens: 100,
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("Unknown model");
  });
});
