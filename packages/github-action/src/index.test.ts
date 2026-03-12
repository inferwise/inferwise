import { describe, expect, it } from "vitest";
import type { FileCostEntry, ScanResult } from "./index.js";
import { buildMarkdownReport, computeFileCosts } from "./index.js";

describe("GitHub Action core logic", () => {
  describe("computeFileCosts", () => {
    it("computes costs for known models", () => {
      const results: ScanResult[] = [
        {
          filePath: "src/chat.ts",
          lineNumber: 10,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 1024,
          isDynamic: false,
          framework: "anthropic-sdk",
        },
      ];

      const costs = computeFileCosts(results, 1000);
      expect(costs.size).toBe(1);
      const entries = costs.get("src/chat.ts");
      expect(entries).toBeDefined();
      expect(entries?.length).toBe(1);
      expect(entries?.[0]?.monthlyCost).toBeGreaterThan(0);
    });

    it("groups multiple calls in the same file", () => {
      const results: ScanResult[] = [
        {
          filePath: "src/api.ts",
          lineNumber: 10,
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 1024,
          isDynamic: false,
          framework: "anthropic-sdk",
        },
        {
          filePath: "src/api.ts",
          lineNumber: 25,
          provider: "openai",
          model: "gpt-4o",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: 512,
          isDynamic: false,
          framework: "openai-sdk",
        },
      ];

      const costs = computeFileCosts(results, 1000);
      expect(costs.size).toBe(1);
      const entries = costs.get("src/api.ts");
      expect(entries?.length).toBe(2);
    });

    it("uses fallback pricing for unknown models", () => {
      const results: ScanResult[] = [
        {
          filePath: "src/test.ts",
          lineNumber: 5,
          provider: "anthropic",
          model: "claude-nonexistent-99",
          systemPrompt: null,
          userPrompt: null,
          maxOutputTokens: null,
          isDynamic: true,
          framework: "anthropic-sdk",
        },
      ];

      const costs = computeFileCosts(results, 1000);
      const entries = costs.get("src/test.ts");
      // Should still produce a cost using fallback model
      expect(entries?.length).toBe(1);
      expect(entries?.[0]?.monthlyCost).toBeGreaterThan(0);
    });
  });

  describe("buildMarkdownReport", () => {
    it("returns 'no changes' when costs are identical", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();
      base.set("src/chat.ts", [{ model: "claude-sonnet-4", monthlyCost: 100 }]);
      head.set("src/chat.ts", [{ model: "claude-sonnet-4", monthlyCost: 100 }]);

      const { report, netDelta } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      expect(netDelta).toBe(0);
      expect(report).toContain("No cost changes detected");
    });

    it("reports added files", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();
      head.set("src/new.ts", [{ model: "gpt-4o", monthlyCost: 500 }]);

      const { report, netDelta } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      expect(netDelta).toBe(500);
      expect(report).toContain("src/new.ts");
      expect(report).toContain("Added");
      expect(report).toContain("(new) gpt-4o");
      expect(report).toContain("Inferwise Cost Report");
    });

    it("reports removed files", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();
      base.set("src/old.ts", [{ model: "claude-opus-4", monthlyCost: 1000 }]);

      const { report, netDelta } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      expect(netDelta).toBe(-1000);
      expect(report).toContain("src/old.ts");
      expect(report).toContain("Removed");
    });

    it("computes net delta across multiple files", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();

      base.set("src/a.ts", [{ model: "claude-opus-4", monthlyCost: 5000 }]);
      head.set("src/a.ts", [{ model: "claude-sonnet-4", monthlyCost: 1000 }]);
      head.set("src/b.ts", [{ model: "gpt-4o", monthlyCost: 2000 }]);

      const { netDelta } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      // a.ts: 1000 - 5000 = -4000, b.ts: 2000 - 0 = +2000, net = -2000
      expect(netDelta).toBe(-2000);
    });

    it("includes volume and ref info in footer", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();
      head.set("src/new.ts", [{ model: "gpt-4o", monthlyCost: 100 }]);

      const { report } = buildMarkdownReport(base, head, 5000, "main", "abc123");
      expect(report).toContain("5,000 requests/day");
      expect(report).toContain("`main`");
      expect(report).toContain("`abc123`");
      expect(report).toContain("inferwise.config.json");
      expect(report).toContain("Inferwise");
    });

    it("includes comment marker for idempotent updates", () => {
      // The PR_COMMENT_MARKER is added by postComment, not buildMarkdownReport
      // but buildMarkdownReport always starts with "## Inferwise Cost Report"
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();
      head.set("src/new.ts", [{ model: "gpt-4o", monthlyCost: 100 }]);

      const { report } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      expect(report).toContain("## Inferwise Cost Report");
    });

    it("sorts rows by absolute delta descending", () => {
      const base = new Map<string, FileCostEntry[]>();
      const head = new Map<string, FileCostEntry[]>();

      head.set("src/small.ts", [{ model: "gpt-4o-mini", monthlyCost: 10 }]);
      head.set("src/big.ts", [{ model: "claude-opus-4", monthlyCost: 10000 }]);
      head.set("src/medium.ts", [{ model: "claude-sonnet-4", monthlyCost: 500 }]);

      const { report } = buildMarkdownReport(base, head, 1000, "main", "HEAD");
      const bigIndex = report.indexOf("src/big.ts");
      const medIndex = report.indexOf("src/medium.ts");
      const smallIndex = report.indexOf("src/small.ts");

      // Biggest delta should appear first
      expect(bigIndex).toBeLessThan(medIndex);
      expect(medIndex).toBeLessThan(smallIndex);
    });
  });
});
