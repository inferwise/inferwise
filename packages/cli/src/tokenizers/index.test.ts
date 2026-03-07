import { afterAll, describe, expect, it } from "vitest";
import { countMessageTokens, countTokens, freeEncoders } from "./index.js";

afterAll(() => {
  freeEncoders();
});

describe("countTokens", () => {
  const HELLO_WORLD = "Hello, world!";

  it("returns 0 for empty string", () => {
    expect(countTokens("openai", "gpt-4o", "")).toBe(0);
    expect(countTokens("anthropic", "claude-sonnet-4-6", "")).toBe(0);
    expect(countTokens("google", "gemini-2.5-pro", "")).toBe(0);
  });

  describe("openai", () => {
    it("counts tokens for gpt-4o (known model)", () => {
      const count = countTokens("openai", "gpt-4o", HELLO_WORLD);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(10);
    });

    it("counts tokens for gpt-4o-mini", () => {
      const count = countTokens("openai", "gpt-4o-mini", HELLO_WORLD);
      expect(count).toBeGreaterThan(0);
    });

    it("counts tokens for o1", () => {
      const count = countTokens("openai", "o1", HELLO_WORLD);
      expect(count).toBeGreaterThan(0);
    });

    it("counts tokens for o3", () => {
      const count = countTokens("openai", "o3", HELLO_WORLD);
      expect(count).toBeGreaterThan(0);
    });

    it("falls back to cl100k for unknown openai model", () => {
      const unknown = countTokens("openai", "gpt-future-unknown", HELLO_WORLD);
      const cl100k = countTokens("anthropic", "claude-any", HELLO_WORLD);
      expect(unknown).toBe(cl100k);
    });

    it("scales proportionally with text length", () => {
      const short = countTokens("openai", "gpt-4o", "Hello");
      const long = countTokens("openai", "gpt-4o", "Hello ".repeat(100));
      expect(long).toBeGreaterThan(short * 50);
    });
  });

  describe("anthropic", () => {
    it("counts tokens using cl100k approximation", () => {
      const count = countTokens("anthropic", "claude-sonnet-4-6", HELLO_WORLD);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(10);
    });

    it("produces same result for any anthropic model id (encoding is fixed)", () => {
      const a = countTokens("anthropic", "claude-opus-4", HELLO_WORLD);
      const b = countTokens("anthropic", "claude-haiku-4", HELLO_WORLD);
      expect(a).toBe(b);
    });
  });

  describe("google", () => {
    it("applies 1.1x correction factor vs cl100k baseline", () => {
      const text = "This is a test sentence for token counting purposes.";
      const google = countTokens("google", "gemini-2.5-pro", text);
      const anthropic = countTokens("anthropic", "claude-sonnet-4-6", text);
      // Google should be ceil(anthropic * 1.1)
      expect(google).toBe(Math.ceil(anthropic * 1.1));
    });

    it("counts tokens greater than or equal to anthropic for same text", () => {
      const text = "A moderately long sentence with various words and punctuation marks!";
      const google = countTokens("google", "gemini-2.5-flash", text);
      const anthropic = countTokens("anthropic", "claude-sonnet-4-6", text);
      expect(google).toBeGreaterThanOrEqual(anthropic);
    });
  });

  describe("xai", () => {
    it("counts tokens using cl100k baseline", () => {
      const xai = countTokens("xai", "grok-3", HELLO_WORLD);
      const anthropic = countTokens("anthropic", "claude-sonnet-4-6", HELLO_WORLD);
      expect(xai).toBe(anthropic);
    });
  });
});

describe("countMessageTokens", () => {
  it("counts system + user tokens with overhead", () => {
    const system = "You are a helpful assistant.";
    const user = "What is the weather today?";
    const total = countMessageTokens("openai", "gpt-4o", { system, user });
    const systemOnly = countTokens("openai", "gpt-4o", system);
    const userOnly = countTokens("openai", "gpt-4o", user);
    // Should be sum + overhead (8 tokens for two messages)
    expect(total).toBe(systemOnly + userOnly + 8);
  });

  it("handles system-only messages", () => {
    const system = "You are a helpful assistant.";
    const total = countMessageTokens("anthropic", "claude-sonnet-4-6", { system });
    const base = countTokens("anthropic", "claude-sonnet-4-6", system);
    expect(total).toBe(base + 4);
  });

  it("handles user-only messages", () => {
    const user = "What is 2 + 2?";
    const total = countMessageTokens("openai", "gpt-4o", { user });
    const base = countTokens("openai", "gpt-4o", user);
    expect(total).toBe(base + 4);
  });

  it("returns 0 for empty params", () => {
    expect(countMessageTokens("openai", "gpt-4o", {})).toBe(0);
  });
});
