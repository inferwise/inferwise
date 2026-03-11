import { describe, expect, it } from "vitest";
import type { EstimateRow, EstimateSummary } from "./index.js";
import { formatJson, formatMarkdown, formatTable } from "./index.js";

function makeRow(overrides: Partial<EstimateRow> = {}): EstimateRow {
  return {
    file: "src/chat.ts",
    line: 42,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    inputTokens: 1000,
    inputTokenSource: "code",
    outputTokens: 500,
    outputTokenSource: "code",
    costPerCall: 0.0105,
    monthlyCost: 315,
    ...overrides,
  };
}

function makeSummary(rows: EstimateRow[] = [makeRow()]): EstimateSummary {
  const totalMonthlyCost = rows.reduce((sum, r) => sum + r.monthlyCost, 0);
  return { rows, totalMonthlyCost, volume: 1000 };
}

describe("formatJson", () => {
  it("returns valid JSON with expected structure", () => {
    const summary = makeSummary();
    const output = formatJson(summary);
    const parsed = JSON.parse(output);

    expect(parsed.totalMonthlyCost).toBe(315);
    expect(parsed.volume).toBe(1000);
    expect(parsed.callSites).toHaveLength(1);
    expect(parsed.callSites[0].file).toBe("src/chat.ts");
    expect(parsed.callSites[0].provider).toBe("anthropic");
  });

  it("handles empty rows", () => {
    const summary = makeSummary([]);
    const parsed = JSON.parse(formatJson(summary));
    expect(parsed.callSites).toHaveLength(0);
    expect(parsed.totalMonthlyCost).toBe(0);
  });

  it("includes token source information", () => {
    const row = makeRow({ inputTokenSource: "model_limit", outputTokenSource: "production" });
    const parsed = JSON.parse(formatJson(makeSummary([row])));
    expect(parsed.callSites[0].inputTokenSource).toBe("model_limit");
    expect(parsed.callSites[0].outputTokenSource).toBe("production");
  });
});

describe("formatMarkdown", () => {
  it("contains markdown table headers", () => {
    const output = formatMarkdown(makeSummary());
    expect(output).toContain("## Inferwise Cost Report");
    expect(output).toContain("| File |");
    expect(output).toContain("|------|");
  });

  it("includes file and model in table rows", () => {
    const output = formatMarkdown(makeSummary());
    expect(output).toContain("`src/chat.ts`");
    expect(output).toContain("claude-sonnet-4-20250514");
  });

  it("shows total monthly cost", () => {
    const output = formatMarkdown(makeSummary());
    expect(output).toContain("**Total monthly cost:");
  });

  it("marks model_limit tokens with asterisk", () => {
    const row = makeRow({ inputTokenSource: "model_limit" });
    const output = formatMarkdown(makeSummary([row]));
    expect(output).toContain("\\*");
  });

  it("marks typical tokens with approx symbol", () => {
    const row = makeRow({ inputTokenSource: "typical" });
    const output = formatMarkdown(makeSummary([row]));
    expect(output).toContain("≈");
    expect(output).toContain("Typical estimate");
  });

  it("marks production tokens with dagger", () => {
    const row = makeRow({ inputTokenSource: "production" });
    const output = formatMarkdown(makeSummary([row]));
    expect(output).toContain("†");
  });

  it("shows empty message for no results", () => {
    const output = formatMarkdown(makeSummary([]));
    expect(output).toContain("No LLM API calls detected.");
  });

  it("includes volume in footer", () => {
    const output = formatMarkdown(makeSummary());
    expect(output).toContain("1,000 requests/day");
  });
});

describe("formatTable", () => {
  it("contains column headers", () => {
    const output = formatTable(makeSummary());
    expect(output).toContain("File");
    expect(output).toContain("Provider");
    expect(output).toContain("Model");
    expect(output).toContain("Cost/Call");
  });

  it("shows total monthly cost line", () => {
    const output = formatTable(makeSummary());
    expect(output).toContain("Total monthly cost:");
  });

  it("shows empty message for no results", () => {
    const output = formatTable(makeSummary([]));
    expect(output).toContain("No LLM API calls detected.");
  });

  it("shows model_limit footnote when applicable", () => {
    const row = makeRow({ inputTokenSource: "model_limit" });
    const output = formatTable(makeSummary([row]));
    expect(output).toContain("Worst-case ceiling");
  });

  it("shows typical footnote when applicable", () => {
    const row = makeRow({ inputTokenSource: "typical" });
    const output = formatTable(makeSummary([row]));
    expect(output).toContain("Typical estimate");
  });

  it("shows production footnote when applicable", () => {
    const row = makeRow({ outputTokenSource: "production" });
    const output = formatTable(makeSummary([row]));
    expect(output).toContain("production usage data");
  });

  it("handles multiple rows", () => {
    const rows = [
      makeRow({ file: "src/a.ts", line: 10 }),
      makeRow({ file: "src/b.ts", line: 20, provider: "openai", model: "gpt-4o" }),
    ];
    const output = formatTable(makeSummary(rows));
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
    expect(output).toContain("openai");
  });
});
