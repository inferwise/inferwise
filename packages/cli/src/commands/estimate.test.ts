import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildEstimateRows } from "../estimate-core.js";
import type { ScanResult } from "../scanners/index.js";
import { estimate } from "../sdk.js";

describe("estimate core logic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-estimate-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("resolveInputTokens via buildEstimateRows", () => {
    it("returns code source when system prompt is present", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: "You are a helpful assistant.",
          userPrompt: null,
          maxOutputTokens: 1024,
          isDynamic: false,
          framework: "anthropic-sdk",
        },
      ];
      const { rows } = buildEstimateRows(results, {}, 1000, false, null, null);
      expect(rows[0]?.inputTokenSource).toBe("code");
      expect(rows[0]?.inputTokens).toBeGreaterThan(0);
    });

    it("returns typical source when no prompts are in code", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: null,
          isDynamic: true,
          framework: "anthropic-sdk",
        },
      ];
      const { rows } = buildEstimateRows(results, {}, 1000, false, null, null);
      expect(rows[0]?.inputTokenSource).toBe("typical");
      // Typical heuristic is 4096 for models with context_window >= 16384
      expect(rows[0]?.inputTokens).toBe(4096);
    });
  });

  describe("resolveOutputTokens via buildEstimateRows", () => {
    it("returns code source when max_tokens is extracted", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 2048,
          isDynamic: true,
          framework: "anthropic-sdk",
        },
      ];
      const { rows } = buildEstimateRows(results, {}, 1000, false, null, null);
      expect(rows[0]?.outputTokenSource).toBe("code");
      expect(rows[0]?.outputTokens).toBe(2048);
    });

    it("returns typical source when no max_tokens found", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "openai",
          model: "gpt-4o",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: null,
          isDynamic: true,
          framework: "openai-sdk",
        },
      ];
      const { rows } = buildEstimateRows(results, {}, 1000, false, null, null);
      expect(rows[0]?.outputTokenSource).toBe("typical");
      // Typical output = max(512, min(4096, max_output_tokens * 0.05))
      expect(rows[0]?.outputTokens).toBeGreaterThanOrEqual(512);
      expect(rows[0]?.outputTokens).toBeLessThanOrEqual(4096);
    });
  });

  describe("volume override from config", () => {
    it("applies config override volume to matching file paths", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );

      const lowVolume = await estimate(tmpDir, { volume: 100 });
      const highVolume = await estimate(tmpDir, { volume: 5000 });

      expect(highVolume.totalMonthlyCost).toBeGreaterThan(lowVolume.totalMonthlyCost);
      // Monthly cost scales linearly with volume
      const ratio = highVolume.totalMonthlyCost / lowVolume.totalMonthlyCost;
      expect(ratio).toBeCloseTo(50, 0); // 5000/100 = 50
    });

    it("uses config defaultVolume when CLI volume is not explicit", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 1024,
          isDynamic: true,
          framework: "anthropic-sdk",
        },
      ];
      // cliVolumeExplicit=false, so config.defaultVolume should take precedence
      const config = { defaultVolume: 500 };
      const { rows: rows500 } = buildEstimateRows(results, config, 1000, false, null, null);
      const { rows: rowsCli } = buildEstimateRows(results, config, 1000, true, null, null);

      // With defaultVolume=500 (non-explicit CLI), monthly cost should be half of explicit CLI 1000
      const ratioDefault = rows500[0]?.monthlyCost ?? 0;
      const ratioCli = rowsCli[0]?.monthlyCost ?? 0;
      expect(ratioDefault).toBeLessThan(ratioCli);
    });
  });

  describe("unknown model handling", () => {
    it("returns result with unknown model tracked", () => {
      const results: ScanResult[] = [
        {
          filePath: "chat.ts",
          lineNumber: 1,
          provider: "anthropic",
          model: "claude-nonexistent-99",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 1024,
          isDynamic: true,
          framework: "anthropic-sdk",
        },
      ];
      const { rows, unknownModels } = buildEstimateRows(results, {}, 1000, false, null, null);
      expect(unknownModels.size).toBe(1);
      expect(unknownModels.has("anthropic/claude-nonexistent-99")).toBe(true);
      // Should still produce a row using fallback pricing
      expect(rows.length).toBe(1);
      expect(rows[0]?.costPerCall).toBeGreaterThan(0);
    });

    it("reports unknown models through SDK estimate", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
          model: "claude-does-not-exist-v99",
          max_tokens: 1024,
          messages: [{ role: "user", content: query }],
        });\n`,
      );
      const result = await estimate(tmpDir);
      expect(result.unknownModels.length).toBeGreaterThan(0);
      expect(result.unknownModels[0]).toContain("claude-does-not-exist-v99");
      // Still produces cost estimates via fallback
      expect(result.rows.length).toBe(1);
      expect(result.totalMonthlyCost).toBeGreaterThan(0);
    });
  });
});
