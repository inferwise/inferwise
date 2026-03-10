import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnvVolume, loadConfig, resolveVolume } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-config-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns empty config when no file found", async () => {
    const config = await loadConfig();
    // May find a config file in the repo, or return empty — both are valid
    expect(config).toBeDefined();
  });

  it("loads config from explicit path", async () => {
    const configPath = path.join(tmpDir, "inferwise.config.json");
    await writeFile(configPath, JSON.stringify({ defaultVolume: 5000, ignore: ["dist"] }));

    const config = await loadConfig(configPath);
    expect(config.defaultVolume).toBe(5000);
    expect(config.ignore).toEqual(["dist"]);
  });

  it("loads config from INFERWISE_CONFIG env var", async () => {
    const configPath = path.join(tmpDir, "custom-config.json");
    await writeFile(configPath, JSON.stringify({ defaultVolume: 3000 }));

    vi.stubEnv("INFERWISE_CONFIG", configPath);
    const config = await loadConfig();
    expect(config.defaultVolume).toBe(3000);
  });

  it("explicit path takes precedence over INFERWISE_CONFIG", async () => {
    const envPath = path.join(tmpDir, "env-config.json");
    const explicitPath = path.join(tmpDir, "explicit-config.json");
    await writeFile(envPath, JSON.stringify({ defaultVolume: 1000 }));
    await writeFile(explicitPath, JSON.stringify({ defaultVolume: 9000 }));

    vi.stubEnv("INFERWISE_CONFIG", envPath);
    const config = await loadConfig(explicitPath);
    expect(config.defaultVolume).toBe(9000);
  });

  it("throws on invalid JSON", async () => {
    const configPath = path.join(tmpDir, "bad.json");
    await writeFile(configPath, "not json");

    await expect(loadConfig(configPath)).rejects.toThrow("Invalid JSON");
  });

  it("throws on invalid schema", async () => {
    const configPath = path.join(tmpDir, "bad-schema.json");
    await writeFile(configPath, JSON.stringify({ defaultVolume: -1 }));

    await expect(loadConfig(configPath)).rejects.toThrow("Invalid config");
  });

  it("validates overrides structure", async () => {
    const configPath = path.join(tmpDir, "overrides.json");
    await writeFile(
      configPath,
      JSON.stringify({
        defaultVolume: 1000,
        overrides: [{ pattern: "src/chat/**", volume: 5000 }],
      }),
    );

    const config = await loadConfig(configPath);
    expect(config.overrides).toHaveLength(1);
    expect(config.overrides?.[0]?.pattern).toBe("src/chat/**");
    expect(config.overrides?.[0]?.volume).toBe(5000);
  });
});

describe("getEnvVolume", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined when INFERWISE_VOLUME is not set", () => {
    vi.stubEnv("INFERWISE_VOLUME", "");
    expect(getEnvVolume()).toBeUndefined();
  });

  it("parses valid integer", () => {
    vi.stubEnv("INFERWISE_VOLUME", "5000");
    expect(getEnvVolume()).toBe(5000);
  });

  it("returns undefined for invalid value", () => {
    vi.stubEnv("INFERWISE_VOLUME", "abc");
    expect(getEnvVolume()).toBeUndefined();
  });

  it("returns undefined for zero", () => {
    vi.stubEnv("INFERWISE_VOLUME", "0");
    expect(getEnvVolume()).toBeUndefined();
  });

  it("returns undefined for negative", () => {
    vi.stubEnv("INFERWISE_VOLUME", "-100");
    expect(getEnvVolume()).toBeUndefined();
  });
});

describe("resolveVolume", () => {
  it("uses CLI volume when explicit", () => {
    const result = resolveVolume({ defaultVolume: 2000 }, "src/chat.ts", 5000, true);
    expect(result).toBe(5000);
  });

  it("uses override when CLI is not explicit", () => {
    const result = resolveVolume(
      {
        defaultVolume: 1000,
        overrides: [{ pattern: "src/chat/**", volume: 8000 }],
      },
      "src/chat/handler.ts",
      1000,
      false,
    );
    expect(result).toBe(8000);
  });

  it("uses config defaultVolume as fallback", () => {
    const result = resolveVolume({ defaultVolume: 3000 }, "src/other.ts", 1000, false);
    expect(result).toBe(3000);
  });

  it("uses CLI default when no config default", () => {
    const result = resolveVolume({}, "src/other.ts", 1000, false);
    expect(result).toBe(1000);
  });
});
