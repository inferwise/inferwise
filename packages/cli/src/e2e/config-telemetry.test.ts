/**
 * End-to-end tests for telemetry config loading and backward compatibility.
 *
 * Verifies that:
 * - New "telemetry" config field is parsed correctly
 * - Legacy "apiUrl" + "apiKey" still works
 * - Config validation catches invalid telemetry configs
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("telemetry config e2e", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-config-telemetry-e2e-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads config with new telemetry field (grafana-tempo)", async () => {
    const config = {
      defaultVolume: 500,
      telemetry: {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
        headers: { "X-Scope-OrgID": "team-platform" },
        apiKey: "glsa_test_key_123",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    const loaded = await loadConfig(path.join(tmpDir, "inferwise.config.json"));
    expect(loaded.telemetry).toBeDefined();
    expect(loaded.telemetry?.backend).toBe("grafana-tempo");
    expect(loaded.telemetry?.endpoint).toBe("https://tempo.internal:3200");
    expect(loaded.telemetry?.headers?.["X-Scope-OrgID"]).toBe("team-platform");
    expect(loaded.telemetry?.apiKey).toBe("glsa_test_key_123");
  });

  it("loads config with new telemetry field (otlp)", async () => {
    const config = {
      telemetry: {
        backend: "otlp",
        endpoint: "https://prometheus.internal:9090",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    const loaded = await loadConfig(path.join(tmpDir, "inferwise.config.json"));
    expect(loaded.telemetry?.backend).toBe("otlp");
    expect(loaded.telemetry?.endpoint).toBe("https://prometheus.internal:9090");
    expect(loaded.telemetry?.headers).toBeUndefined();
    expect(loaded.telemetry?.apiKey).toBeUndefined();
  });

  it("loads config with legacy apiUrl + apiKey (backward compatible)", async () => {
    const config = {
      apiUrl: "https://api.inferwise.dev",
      apiKey: "iw_production_key",
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    const loaded = await loadConfig(path.join(tmpDir, "inferwise.config.json"));
    expect(loaded.telemetry).toBeUndefined();
    expect(loaded.apiUrl).toBe("https://api.inferwise.dev");
    expect(loaded.apiKey).toBe("iw_production_key");
  });

  it("supports both telemetry and legacy fields simultaneously", async () => {
    const config = {
      telemetry: {
        backend: "grafana-tempo",
        endpoint: "https://tempo.internal:3200",
      },
      apiUrl: "https://api.inferwise.dev",
      apiKey: "iw_old_key",
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    const loaded = await loadConfig(path.join(tmpDir, "inferwise.config.json"));
    // Both should load — estimate command will prefer telemetry over legacy
    expect(loaded.telemetry?.backend).toBe("grafana-tempo");
    expect(loaded.apiUrl).toBe("https://api.inferwise.dev");
  });

  it("rejects invalid telemetry backend", async () => {
    const config = {
      telemetry: {
        backend: "invalid-backend",
        endpoint: "https://example.com",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    await expect(loadConfig(path.join(tmpDir, "inferwise.config.json"))).rejects.toThrow();
  });

  it("rejects telemetry config without endpoint", async () => {
    const config = {
      telemetry: {
        backend: "grafana-tempo",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    await expect(loadConfig(path.join(tmpDir, "inferwise.config.json"))).rejects.toThrow();
  });

  it("rejects telemetry config with invalid endpoint URL", async () => {
    const config = {
      telemetry: {
        backend: "otlp",
        endpoint: "not-a-url",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    await expect(loadConfig(path.join(tmpDir, "inferwise.config.json"))).rejects.toThrow();
  });

  it("config with telemetry + budgets + overrides all load correctly", async () => {
    const config = {
      defaultVolume: 2000,
      ignore: ["node_modules", "dist"],
      overrides: [{ pattern: "src/chat/**", volume: 5000 }],
      budgets: { warn: 1000, block: 50000 },
      telemetry: {
        backend: "grafana-tempo",
        endpoint: "https://tempo.grafana.net",
        headers: { "X-Scope-OrgID": "my-org" },
        apiKey: "glsa_abc123",
      },
    };
    await writeFile(path.join(tmpDir, "inferwise.config.json"), JSON.stringify(config));

    const loaded = await loadConfig(path.join(tmpDir, "inferwise.config.json"));

    expect(loaded.defaultVolume).toBe(2000);
    expect(loaded.ignore).toEqual(["node_modules", "dist"]);
    expect(loaded.overrides?.[0]?.volume).toBe(5000);
    expect(loaded.budgets?.warn).toBe(1000);
    expect(loaded.budgets?.block).toBe(50000);
    expect(loaded.telemetry?.backend).toBe("grafana-tempo");
    expect(loaded.telemetry?.endpoint).toBe("https://tempo.grafana.net");
    expect(loaded.telemetry?.headers?.["X-Scope-OrgID"]).toBe("my-org");
  });
});
