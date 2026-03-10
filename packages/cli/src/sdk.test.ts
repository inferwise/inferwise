import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimate, estimateAndCheck } from "./sdk.js";

describe("SDK", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-sdk-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("estimate", () => {
    it("returns empty rows for directory with no LLM calls", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), "console.log('hello');\n");
      const result = await estimate(tmpDir);
      expect(result.rows).toEqual([]);
      expect(result.totalMonthlyCost).toBe(0);
      expect(result.volume).toBe(1000);
    });

    it("detects LLM calls and returns cost data", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const result = await estimate(tmpDir);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]?.provider).toBe("anthropic");
      expect(result.rows[0]?.model).toBe("claude-sonnet-4-20250514");
      expect(result.totalMonthlyCost).toBeGreaterThan(0);
    });

    it("respects volume option", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const low = await estimate(tmpDir, { volume: 100 });
      const high = await estimate(tmpDir, { volume: 10000 });
      expect(high.totalMonthlyCost).toBeGreaterThan(low.totalMonthlyCost);
    });
  });

  describe("estimateAndCheck", () => {
    it("returns ok:true when under budget", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 999999 });
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("returns ok:false when over monthly budget", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 0.001 });
      expect(result.ok).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0]?.type).toBe("monthly_total");
    });

    it("checks per-call cost limit", async () => {
      await writeFile(
        path.join(tmpDir, "expensive.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-opus-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const result = await estimateAndCheck(tmpDir, { maxCostPerCall: 0.0001 });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.type === "per_call")).toBe(true);
    });

    it("returns ok:true for empty project", async () => {
      await writeFile(path.join(tmpDir, "app.ts"), "console.log('hello');\n");
      const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 100 });
      expect(result.ok).toBe(true);
      expect(result.rows).toEqual([]);
    });
  });
});
