import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyModelSwap, applyRecommendations } from "../fix-core.js";

describe("fix-core", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-fix-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("applyModelSwap", () => {
    it("replaces double-quoted model string on the target line", () => {
      const content = `const response = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  max_tokens: 1024,
});`;
      const result = applyModelSwap(
        content,
        2,
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
      );
      expect(result).not.toBeNull();
      expect(result?.content).toContain('"claude-sonnet-4-20250514"');
      expect(result?.content).not.toContain('"claude-opus-4-20250514"');
    });

    it("replaces single-quoted model string", () => {
      const content = `const response = await anthropic.messages.create({
  model: 'claude-opus-4-20250514',
  max_tokens: 1024,
});`;
      const result = applyModelSwap(
        content,
        2,
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
      );
      expect(result).not.toBeNull();
      expect(result?.content).toContain("'claude-sonnet-4-20250514'");
    });

    it("replaces backtick-quoted model string", () => {
      const content =
        "const response = await anthropic.messages.create({\n  model: `claude-opus-4-20250514`,\n});";
      const result = applyModelSwap(
        content,
        2,
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
      );
      expect(result).not.toBeNull();
      expect(result?.content).toContain("`claude-sonnet-4-20250514`");
    });

    it("finds model string on nearby lines (window search)", () => {
      // Scanner reports line 1 (.create), but model is on line 2
      const content = `const response = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  max_tokens: 1024,
});`;
      const result = applyModelSwap(
        content,
        1,
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
      );
      expect(result).not.toBeNull();
      expect(result?.content).toContain('"claude-sonnet-4-20250514"');
      expect(result?.actualLine).toBe(2);
    });

    it("returns null if model not found anywhere in window", () => {
      const content = `const model = getModel();
const response = await anthropic.messages.create({
  model: model,
  max_tokens: 1024,
});`;
      const result = applyModelSwap(
        content,
        3,
        "claude-opus-4-20250514",
        "claude-sonnet-4-20250514",
      );
      expect(result).toBeNull();
    });

    it("returns null if line number is out of range", () => {
      const content = "const x = 1;";
      expect(applyModelSwap(content, 0, "model", "new-model")).toBeNull();
      expect(applyModelSwap(content, 5, "model", "new-model")).toBeNull();
    });

    it("preserves surrounding code", () => {
      const content = `// Comment above
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: query }],
});
// Comment below`;
      const result = applyModelSwap(content, 3, "gpt-4o", "gpt-4o-mini");
      expect(result).not.toBeNull();
      expect(result?.content).toContain("// Comment above");
      expect(result?.content).toContain("// Comment below");
      expect(result?.content).toContain('"gpt-4o-mini"');
    });
  });

  describe("applyRecommendations", () => {
    it("applies swaps to files on disk", async () => {
      await writeFile(
        path.join(tmpDir, "chat.ts"),
        `const response = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: query }],
});\n`,
      );

      const result = await applyRecommendations(
        [
          {
            file: "chat.ts",
            line: 2,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
            monthlySavings: 500,
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(1);
      expect(result.totalSkipped).toBe(0);
      expect(result.estimatedMonthlySavings).toBe(500);

      const updated = await readFile(path.join(tmpDir, "chat.ts"), "utf-8");
      expect(updated).toContain('"claude-sonnet-4-20250514"');
      expect(updated).not.toContain('"claude-opus-4-20250514"');
    });

    it("does not write files in dry-run mode", async () => {
      const original = `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [],
});\n`;
      await writeFile(path.join(tmpDir, "app.ts"), original);

      const result = await applyRecommendations(
        [
          {
            file: "app.ts",
            line: 2,
            currentModel: "gpt-4o",
            suggestedModel: "gpt-4o-mini",
          },
        ],
        tmpDir,
        true,
      );

      expect(result.totalApplied).toBe(1);

      const content = await readFile(path.join(tmpDir, "app.ts"), "utf-8");
      expect(content).toBe(original);
    });

    it("skips dynamic models and reports reason", async () => {
      await writeFile(
        path.join(tmpDir, "dynamic.ts"),
        `const modelName = getModel();
const response = await anthropic.messages.create({
  model: modelName,
  messages: [],
});\n`,
      );

      const result = await applyRecommendations(
        [
          {
            file: "dynamic.ts",
            line: 3,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(0);
      expect(result.totalSkipped).toBe(1);
      expect(result.skipped[0]?.reason).toContain("not found");
    });

    it("handles multiple swaps in the same file", async () => {
      await writeFile(
        path.join(tmpDir, "multi.ts"),
        `const a = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  messages: [{ role: "user", content: q1 }],
});

const b = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  messages: [{ role: "user", content: q2 }],
});\n`,
      );

      const result = await applyRecommendations(
        [
          {
            file: "multi.ts",
            line: 2,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
            monthlySavings: 300,
          },
          {
            file: "multi.ts",
            line: 7,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
            monthlySavings: 300,
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(2);
      expect(result.estimatedMonthlySavings).toBe(600);

      const updated = await readFile(path.join(tmpDir, "multi.ts"), "utf-8");
      expect(updated).not.toContain('"claude-opus-4-20250514"');
      const matches = updated.match(/claude-sonnet-4-20250514/g);
      expect(matches?.length).toBe(2);
    });

    it("handles swaps across multiple files", async () => {
      await writeFile(
        path.join(tmpDir, "a.ts"),
        `const r = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  messages: [],
});\n`,
      );
      await writeFile(
        path.join(tmpDir, "b.ts"),
        `const r = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [],
});\n`,
      );

      const result = await applyRecommendations(
        [
          {
            file: "a.ts",
            line: 2,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
          },
          {
            file: "b.ts",
            line: 2,
            currentModel: "gpt-4o",
            suggestedModel: "gpt-4o-mini",
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(2);

      const aContent = await readFile(path.join(tmpDir, "a.ts"), "utf-8");
      expect(aContent).toContain('"claude-sonnet-4-20250514"');

      const bContent = await readFile(path.join(tmpDir, "b.ts"), "utf-8");
      expect(bContent).toContain('"gpt-4o-mini"');
    });

    it("skips missing files and reports reason", async () => {
      const result = await applyRecommendations(
        [
          {
            file: "nonexistent.ts",
            line: 2,
            currentModel: "gpt-4o",
            suggestedModel: "gpt-4o-mini",
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(0);
      expect(result.totalSkipped).toBe(1);
      expect(result.skipped[0]?.reason).toContain("not found");
    });

    it("handles Python files with single quotes", async () => {
      await writeFile(
        path.join(tmpDir, "app.py"),
        `response = client.messages.create(
    model='claude-opus-4-20250514',
    max_tokens=1024,
)\n`,
      );

      const result = await applyRecommendations(
        [
          {
            file: "app.py",
            line: 2,
            currentModel: "claude-opus-4-20250514",
            suggestedModel: "claude-sonnet-4-20250514",
          },
        ],
        tmpDir,
        false,
      );

      expect(result.totalApplied).toBe(1);

      const updated = await readFile(path.join(tmpDir, "app.py"), "utf-8");
      expect(updated).toContain("'claude-sonnet-4-20250514'");
    });
  });
});
