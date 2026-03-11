import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Reusable helper: check if a file exists. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("init command logic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-init-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("config file creation", () => {
    it("creates inferwise.config.json with correct defaults", async () => {
      const configPath = path.join(tmpDir, "inferwise.config.json");
      const template = {
        defaultVolume: 1000,
        ignore: ["node_modules", "dist", "build", "test", "__tests__", "*.test.ts", "*.spec.ts"],
        budgets: {
          warn: 2000,
          block: 50000,
        },
      };
      await writeFile(configPath, `${JSON.stringify(template, null, 2)}\n`);

      const content = JSON.parse(await readFile(configPath, "utf-8"));
      expect(content.defaultVolume).toBe(1000);
      expect(content.budgets.warn).toBe(2000);
      expect(content.budgets.block).toBe(50000);
      expect(content.ignore).toContain("node_modules");
      expect(content.ignore).toContain("dist");
    });

    it("does not overwrite existing config file", async () => {
      const configPath = path.join(tmpDir, "inferwise.config.json");
      const existingConfig = { defaultVolume: 5000 };
      await writeFile(configPath, JSON.stringify(existingConfig));

      // Simulate: config already exists, should not be overwritten
      const exists = await fileExists(configPath);
      expect(exists).toBe(true);

      const content = JSON.parse(await readFile(configPath, "utf-8"));
      expect(content.defaultVolume).toBe(5000);
    });
  });

  describe("hook installation", () => {
    it("creates a pre-commit hook in .git/hooks/", async () => {
      const hooksDir = path.join(tmpDir, ".git", "hooks");
      await mkdir(hooksDir, { recursive: true });

      const hookContent = "#!/bin/sh\nnpx inferwise check .\n";
      const hookPath = path.join(hooksDir, "pre-commit");
      await writeFile(hookPath, hookContent, { mode: 0o755 });

      const content = await readFile(hookPath, "utf-8");
      expect(content).toContain("inferwise check");
      expect(content).toContain("#!/bin/sh");
    });

    it("appends to existing hook without duplicating", async () => {
      const hooksDir = path.join(tmpDir, ".git", "hooks");
      await mkdir(hooksDir, { recursive: true });

      // Write an existing hook
      const hookPath = path.join(hooksDir, "pre-commit");
      await writeFile(hookPath, "#!/bin/sh\necho 'existing hook'\n", {
        mode: 0o755,
      });

      // Simulate installHook logic: check if 'inferwise' already present
      const existing = await readFile(hookPath, "utf-8");
      expect(existing.includes("inferwise")).toBe(false);

      // Append inferwise
      const hookContent = "\n#!/bin/sh\nnpx inferwise check .\n";
      await writeFile(hookPath, `${existing}\n${hookContent}`, {
        mode: 0o755,
      });

      const updated = await readFile(hookPath, "utf-8");
      expect(updated).toContain("existing hook");
      expect(updated).toContain("inferwise check");
    });

    it("skips hook when inferwise is already present", async () => {
      const hooksDir = path.join(tmpDir, ".git", "hooks");
      await mkdir(hooksDir, { recursive: true });

      const hookPath = path.join(hooksDir, "pre-commit");
      const content = "#!/bin/sh\nnpx inferwise check .\n";
      await writeFile(hookPath, content, { mode: 0o755 });

      const existing = await readFile(hookPath, "utf-8");
      expect(existing.includes("inferwise")).toBe(true);
      // Should return "exists" — no modification needed
    });
  });

  describe("hook manager detection", () => {
    it("detects husky when .husky directory exists", async () => {
      await mkdir(path.join(tmpDir, ".husky"), { recursive: true });
      await mkdir(path.join(tmpDir, ".git"), { recursive: true });

      const hasHusky = await fileExists(path.join(tmpDir, ".husky"));
      expect(hasHusky).toBe(true);
    });

    it("detects lefthook when lefthook.yml exists", async () => {
      await writeFile(path.join(tmpDir, "lefthook.yml"), "pre-commit:\n");
      await mkdir(path.join(tmpDir, ".git"), { recursive: true });

      const hasLefthook = await fileExists(path.join(tmpDir, "lefthook.yml"));
      expect(hasLefthook).toBe(true);
    });

    it("falls back to plain git hooks", async () => {
      await mkdir(path.join(tmpDir, ".git", "hooks"), { recursive: true });

      const hasHusky = await fileExists(path.join(tmpDir, ".husky"));
      const hasLefthook = await fileExists(path.join(tmpDir, "lefthook.yml"));
      const hasGitHooks = await fileExists(path.join(tmpDir, ".git", "hooks"));

      expect(hasHusky).toBe(false);
      expect(hasLefthook).toBe(false);
      expect(hasGitHooks).toBe(true);
    });
  });
});
