import { describe, expect, it } from "vitest";
import { type DiffRow, type FileCost, buildDiff, classifyChange } from "./diff.js";

// ── classifyChange ──────────────────────────────────────────────────

describe("classifyChange", () => {
  it("returns 'added' when base is null and head exists", () => {
    expect(classifyChange(null, "claude-sonnet-4-20250514")).toBe("added");
  });

  it("returns 'removed' when base exists and head is null", () => {
    expect(classifyChange("claude-sonnet-4-20250514", null)).toBe("removed");
  });

  it("returns 'unchanged' when both models are the same", () => {
    expect(classifyChange("gpt-4o", "gpt-4o")).toBe("unchanged");
  });

  it("returns 'modified' when both exist but differ", () => {
    expect(classifyChange("claude-opus-4-20250514", "claude-sonnet-4-20250514")).toBe("modified");
  });

  it("returns 'added' when base is null and head is null-ish empty", () => {
    // Both null — baseModel is falsy, headModel is falsy → unchanged path
    expect(classifyChange(null, null)).toBe("unchanged");
  });
});

// ── Helper to build FileCost fixtures ───────────────────────────────

function makeFileCost(overrides: Partial<FileCost> & { file: string; model: string }): FileCost {
  return {
    provider: "anthropic",
    monthlyCost: 1000,
    costPerCall: 0.033,
    ...overrides,
  };
}

function toMap(entries: FileCost[]): Map<string, FileCost[]> {
  const map = new Map<string, FileCost[]>();
  for (const entry of entries) {
    const existing = map.get(entry.file) ?? [];
    existing.push(entry);
    map.set(entry.file, existing);
  }
  return map;
}

// ── buildDiff ───────────────────────────────────────────────────────

describe("buildDiff", () => {
  it("returns no rows when both base and head are empty", () => {
    const rows = buildDiff(new Map(), new Map());
    expect(rows).toHaveLength(0);
  });

  it("returns 'added' rows when head has a new file", () => {
    const base = new Map<string, FileCost[]>();
    const head = toMap([
      makeFileCost({
        file: "src/chat.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 5000,
      }),
    ]);

    const rows = buildDiff(base, head);
    expect(rows).toHaveLength(1);

    const row = rows[0] as DiffRow;
    expect(row.change).toBe("added");
    expect(row.baseModel).toBeNull();
    expect(row.headModel).toBe("claude-sonnet-4-20250514");
    expect(row.baseMonthlyCost).toBe(0);
    expect(row.headMonthlyCost).toBe(5000);
    expect(row.monthlyDelta).toBe(5000);
  });

  it("returns 'removed' rows when base has a file not in head", () => {
    const base = toMap([
      makeFileCost({
        file: "src/old-feature.ts",
        model: "gpt-4o",
        provider: "openai",
        monthlyCost: 3000,
      }),
    ]);
    const head = new Map<string, FileCost[]>();

    const rows = buildDiff(base, head);
    expect(rows).toHaveLength(1);

    const row = rows[0] as DiffRow;
    expect(row.change).toBe("removed");
    expect(row.baseModel).toBe("gpt-4o");
    expect(row.headModel).toBeNull();
    expect(row.monthlyDelta).toBe(-3000);
  });

  it("produces no rows when same model exists in both with same cost", () => {
    const cost = makeFileCost({
      file: "src/stable.ts",
      model: "claude-sonnet-4-20250514",
      monthlyCost: 2000,
    });
    const base = toMap([cost]);
    const head = toMap([{ ...cost }]);

    const rows = buildDiff(base, head);
    // Same model, same cost → no row emitted (delta === 0, skipped)
    expect(rows).toHaveLength(0);
  });

  it("returns 'modified' row when model changes in the same file (opus -> sonnet)", () => {
    const base = toMap([
      makeFileCost({
        file: "src/summarize.ts",
        model: "claude-opus-4-20250514",
        monthlyCost: 10000,
      }),
    ]);
    const head = toMap([
      makeFileCost({
        file: "src/summarize.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 3000,
      }),
    ]);

    const rows = buildDiff(base, head);
    expect(rows).toHaveLength(1);

    const row = rows[0] as DiffRow;
    expect(row.change).toBe("modified");
    expect(row.baseModel).toBe("claude-opus-4-20250514");
    expect(row.headModel).toBe("claude-sonnet-4-20250514");
    expect(row.monthlyDelta).toBe(-7000);
    expect(row.file).toBe("src/summarize.ts");
  });

  it("handles multiple calls in same file: one added, one removed", () => {
    const base = toMap([
      makeFileCost({
        file: "src/multi.ts",
        model: "claude-opus-4-20250514",
        monthlyCost: 8000,
      }),
      makeFileCost({
        file: "src/multi.ts",
        model: "gpt-4o",
        provider: "openai",
        monthlyCost: 2000,
      }),
    ]);
    const head = toMap([
      makeFileCost({
        file: "src/multi.ts",
        model: "gpt-4o",
        provider: "openai",
        monthlyCost: 2000,
      }),
      makeFileCost({
        file: "src/multi.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 3000,
      }),
    ]);

    const rows = buildDiff(base, head);

    // gpt-4o matches between base and head (same cost → no row)
    // claude-opus-4 in base unmatched, claude-sonnet-4 in head unmatched → paired as "modified"
    const modifiedRows = rows.filter((r) => r.change === "modified");
    expect(modifiedRows).toHaveLength(1);
    expect(modifiedRows[0]?.baseModel).toBe("claude-opus-4-20250514");
    expect(modifiedRows[0]?.headModel).toBe("claude-sonnet-4-20250514");
    expect(modifiedRows[0]?.monthlyDelta).toBe(-5000);
  });

  it("rows are sorted by absolute delta descending", () => {
    const base = new Map<string, FileCost[]>();
    const head = toMap([
      makeFileCost({ file: "src/small.ts", model: "gpt-4o", provider: "openai", monthlyCost: 100 }),
      makeFileCost({
        file: "src/big.ts",
        model: "claude-opus-4-20250514",
        monthlyCost: 50000,
      }),
      makeFileCost({
        file: "src/medium.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 5000,
      }),
    ]);

    const rows = buildDiff(base, head);
    expect(rows).toHaveLength(3);

    // Sorted by |monthlyDelta| descending
    expect(rows[0]?.monthlyDelta).toBe(50000);
    expect(rows[1]?.monthlyDelta).toBe(5000);
    expect(rows[2]?.monthlyDelta).toBe(100);
  });

  it("emits 'unchanged' row with delta when same model has different costs", () => {
    const base = toMap([
      makeFileCost({
        file: "src/pricing-change.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 2000,
      }),
    ]);
    const head = toMap([
      makeFileCost({
        file: "src/pricing-change.ts",
        model: "claude-sonnet-4-20250514",
        monthlyCost: 3000,
      }),
    ]);

    const rows = buildDiff(base, head);
    expect(rows).toHaveLength(1);

    const row = rows[0] as DiffRow;
    expect(row.change).toBe("unchanged");
    expect(row.monthlyDelta).toBe(1000);
  });
});
