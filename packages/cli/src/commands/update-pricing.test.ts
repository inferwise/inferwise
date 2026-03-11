import { getAllProviders, getPricingAgeInDays, getProviderMeta } from "@inferwise/pricing-db";
import { describe, expect, it } from "vitest";

describe("update-pricing command logic", () => {
  describe("pricing freshness", () => {
    it("returns age in days for all providers", () => {
      for (const provider of getAllProviders()) {
        const age = getPricingAgeInDays(provider);
        expect(age).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(age)).toBe(true);
      }
    });

    it("returns provider metadata with last_verified and source", () => {
      for (const provider of getAllProviders()) {
        const meta = getProviderMeta(provider);
        expect(meta.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(meta.source).toBeTruthy();
      }
    });

    it("covers all known providers", () => {
      const providers = getAllProviders();
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("google");
      expect(providers).toContain("xai");
      expect(providers).toContain("perplexity");
    });
  });
});
