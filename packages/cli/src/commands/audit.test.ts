import { describe, expect, it } from "vitest";
import type { ScanResult } from "../scanners/index.js";
import {
  type BatchFinding,
  type CachingFinding,
  type SmartAlternativeFinding,
  detectBatchOpportunities,
  detectCachingOpportunities,
  detectSmartAlternatives,
} from "./audit.js";

const VOLUME = 1000;

// ── ScanResult fixture builder ──────────────────────────────────────

function makeScanResult(overrides: Partial<ScanResult> & { model: string | null }): ScanResult {
  return {
    filePath: "src/chat.ts",
    lineNumber: 10,
    provider: "anthropic",
    systemPrompt: null,
    userPrompt: null,
    maxOutputTokens: null,
    isDynamic: false,
    framework: "anthropic-sdk",
    ...overrides,
  };
}

// ── detectSmartAlternatives ─────────────────────────────────────────

describe("detectSmartAlternatives", () => {
  it("suggests a cheaper alternative for a premium model with code prompt", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-opus-4-6",
        filePath: "src/expensive.ts",
        lineNumber: 5,
        systemPrompt: "You are a code reviewer. Review the code for bugs.",
      }),
    ];

    const findings = detectSmartAlternatives(results, VOLUME);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const finding = findings[0] as SmartAlternativeFinding;
    expect(finding.type).toBe("smart-alternative");
    expect(finding.currentModel).toBe("claude-opus-4-6");
    expect(finding.suggestedModel).toBeDefined();
    expect(finding.monthlySavings).toBeGreaterThan(0);
    expect(finding.requiredCapabilities).toContain("code");
    expect(finding.confidence).toBe("medium");
    expect(finding.reasoning.length).toBeGreaterThan(0);
    expect(finding.file).toBe("src/expensive.ts");
    expect(finding.line).toBe(5);
  });

  it("suggests budget model for classification task", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "gpt-4o",
        provider: "openai",
        filePath: "src/classify.ts",
        lineNumber: 8,
        systemPrompt: "Classify the support ticket into: billing, technical, general.",
      }),
    ];

    const findings = detectSmartAlternatives(results, VOLUME);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const finding = findings[0] as SmartAlternativeFinding;
    expect(finding.type).toBe("smart-alternative");
    expect(finding.requiredCapabilities).toContain("general");
    expect(finding.monthlySavings).toBeGreaterThan(0);
  });

  it("includes high confidence when both prompts are present", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-opus-4-6",
        filePath: "src/chat.ts",
        lineNumber: 10,
        systemPrompt: "You are a helpful assistant.",
        userPrompt: "Summarize this document.",
      }),
    ];

    const findings = detectSmartAlternatives(results, VOLUME);
    if (findings.length > 0) {
      expect((findings[0] as SmartAlternativeFinding).confidence).toBe("high");
    }
  });

  it("returns no suggestion for an unknown model", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "nonexistent-model-xyz",
        filePath: "src/unknown.ts",
        lineNumber: 1,
      }),
    ];

    const findings = detectSmartAlternatives(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("skips results with null model", () => {
    const results: ScanResult[] = [makeScanResult({ model: null, filePath: "src/dynamic.ts" })];

    const findings = detectSmartAlternatives(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("uses low confidence for dynamic prompts (no extracted text)", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-opus-4-6",
        filePath: "src/dynamic.ts",
        lineNumber: 5,
        systemPrompt: null,
        userPrompt: null,
        isDynamic: true,
      }),
    ];

    const findings = detectSmartAlternatives(results, VOLUME);
    for (const f of findings) {
      if (f.type === "smart-alternative") {
        expect(f.confidence).toBe("low");
      }
    }
  });
});

// ── detectCachingOpportunities ──────────────────────────────────────

describe("detectCachingOpportunities", () => {
  it("finds caching opportunity when same system prompt appears in 2+ call sites", () => {
    const sharedPrompt = "You are a helpful coding assistant.";
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/chat.ts",
        lineNumber: 10,
        systemPrompt: sharedPrompt,
      }),
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/review.ts",
        lineNumber: 20,
        systemPrompt: sharedPrompt,
      }),
    ];

    const findings = detectCachingOpportunities(results, VOLUME);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const finding = findings[0] as CachingFinding;
    expect(finding.type).toBe("caching");
    expect(finding.locations).toHaveLength(2);
    expect(finding.monthlySavings).toBeGreaterThan(0);
    expect(finding.model).toBe("claude-sonnet-4-6");
  });

  it("returns no finding when system prompts differ", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/chat.ts",
        lineNumber: 10,
        systemPrompt: "You are a coding assistant.",
      }),
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/review.ts",
        lineNumber: 20,
        systemPrompt: "You are a code reviewer.",
      }),
    ];

    const findings = detectCachingOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("returns no finding when only a single call site has a system prompt", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/chat.ts",
        lineNumber: 10,
        systemPrompt: "You are a helpful assistant.",
      }),
    ];

    const findings = detectCachingOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("returns no finding when system prompt is null", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/a.ts",
        lineNumber: 1,
        systemPrompt: null,
      }),
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/b.ts",
        lineNumber: 2,
        systemPrompt: null,
      }),
    ];

    const findings = detectCachingOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });
});

// ── detectBatchOpportunities ────────────────────────────────────────

describe("detectBatchOpportunities", () => {
  it("finds batch opportunity for multiple calls with same model in same file", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/batch-candidate.ts",
        lineNumber: 10,
      }),
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/batch-candidate.ts",
        lineNumber: 25,
      }),
    ];

    const findings = detectBatchOpportunities(results, VOLUME);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const finding = findings[0] as BatchFinding;
    expect(finding.type).toBe("batch");
    expect(finding.file).toBe("src/batch-candidate.ts");
    expect(finding.model).toBe("claude-sonnet-4-6");
    expect(finding.callCount).toBe(2);
    expect(finding.monthlySavings).toBeGreaterThan(0);
  });

  it("returns no finding for a single call in a file", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/single.ts",
        lineNumber: 5,
      }),
    ];

    const findings = detectBatchOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("does not group calls across different files", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/file-a.ts",
        lineNumber: 10,
      }),
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/file-b.ts",
        lineNumber: 10,
      }),
    ];

    const findings = detectBatchOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("skips results with null model", () => {
    const results: ScanResult[] = [
      makeScanResult({ model: null, filePath: "src/dynamic.ts", lineNumber: 1 }),
      makeScanResult({ model: null, filePath: "src/dynamic.ts", lineNumber: 5 }),
    ];

    const findings = detectBatchOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });

  it("does not group calls with different models in the same file", () => {
    const results: ScanResult[] = [
      makeScanResult({
        model: "claude-sonnet-4-6",
        filePath: "src/mixed.ts",
        lineNumber: 10,
      }),
      makeScanResult({
        model: "claude-opus-4-6",
        filePath: "src/mixed.ts",
        lineNumber: 25,
      }),
    ];

    const findings = detectBatchOpportunities(results, VOLUME);
    expect(findings).toHaveLength(0);
  });
});
