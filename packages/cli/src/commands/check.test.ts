import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateAndCheck } from "../sdk.js";

describe("check command logic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-check-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when no LLM calls found (empty dir)", async () => {
    await writeFile(path.join(tmpDir, "app.ts"), "console.log('no llm here');\n");
    const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 100 });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("passes when costs are under budget", async () => {
    await writeFile(
      path.join(tmpDir, "chat.ts"),
      `const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: query }],
      });\n`,
    );
    // Set a very high limit so it passes
    const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 999999 });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.rows.length).toBe(1);
    expect(result.totalMonthlyCost).toBeGreaterThan(0);
  });

  it("fails when monthly cost exceeds max-monthly-cost", async () => {
    await writeFile(
      path.join(tmpDir, "chat.ts"),
      `const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: query }],
      });\n`,
    );
    // Set an impossibly low limit
    const result = await estimateAndCheck(tmpDir, { maxMonthlyCost: 0.0001 });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.type).toBe("monthly_total");
    expect(result.violations[0]?.actual).toBeGreaterThan(0.0001);
    expect(result.violations[0]?.limit).toBe(0.0001);
  });

  it("fails when cost-per-call exceeds max-cost-per-call", async () => {
    await writeFile(
      path.join(tmpDir, "expensive.ts"),
      `const response = await anthropic.messages.create({
        model: "claude-opus-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: query }],
      });\n`,
    );
    // Set an impossibly low per-call limit
    const result = await estimateAndCheck(tmpDir, { maxCostPerCall: 0.000001 });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.type === "per_call")).toBe(true);
    const perCallViolation = result.violations.find((v) => v.type === "per_call");
    expect(perCallViolation?.file).toBeDefined();
    expect(perCallViolation?.line).toBeDefined();
    expect(perCallViolation?.actual).toBeGreaterThan(0.000001);
  });

  it("uses config budgets.block as fallback for max-monthly-cost", async () => {
    await writeFile(
      path.join(tmpDir, "chat.ts"),
      `const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: query }],
      });\n`,
    );

    // First: confirm that without any limit, it passes (no violations)
    const noLimit = await estimateAndCheck(tmpDir, {});
    expect(noLimit.ok).toBe(true);

    // Now: pass inline config with a very low budgets.block threshold
    const withBlock = await estimateAndCheck(tmpDir, {
      config: { budgets: { block: 0.0001 } },
    });
    expect(withBlock.ok).toBe(false);
    expect(withBlock.violations.length).toBe(1);
    expect(withBlock.violations[0]?.type).toBe("monthly_total");
    expect(withBlock.violations[0]?.limit).toBe(0.0001);
  });

  it("reports both monthly and per-call violations simultaneously", async () => {
    await writeFile(
      path.join(tmpDir, "expensive.ts"),
      `const response = await anthropic.messages.create({
        model: "claude-opus-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: query }],
      });\n`,
    );
    const result = await estimateAndCheck(tmpDir, {
      maxMonthlyCost: 0.0001,
      maxCostPerCall: 0.000001,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.type === "monthly_total")).toBe(true);
    expect(result.violations.some((v) => v.type === "per_call")).toBe(true);
  });

  it("passes with multiple calls all under per-call limit", async () => {
    await writeFile(
      path.join(tmpDir, "multi.ts"),
      `const a = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        messages: [{ role: "user", content: q1 }],
      });
      const b = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 256,
        messages: [{ role: "user", content: q2 }],
      });\n`,
    );
    // Both calls are cheap — set a generous per-call limit
    const result = await estimateAndCheck(tmpDir, { maxCostPerCall: 10 });
    expect(result.ok).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.violations).toEqual([]);
  });
});
