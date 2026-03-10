import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalibrationData } from "./calibration.js";
import {
  clampRatio,
  computeConfidence,
  computeModelCalibration,
  loadCalibration,
  saveCalibration,
} from "./calibration.js";

describe("computeConfidence", () => {
  it("returns low for < 100 samples", () => {
    expect(computeConfidence(0)).toBe("low");
    expect(computeConfidence(50)).toBe("low");
    expect(computeConfidence(99)).toBe("low");
  });

  it("returns medium for 100-999 samples", () => {
    expect(computeConfidence(100)).toBe("medium");
    expect(computeConfidence(500)).toBe("medium");
    expect(computeConfidence(999)).toBe("medium");
  });

  it("returns high for >= 1000 samples", () => {
    expect(computeConfidence(1000)).toBe("high");
    expect(computeConfidence(10000)).toBe("high");
  });
});

describe("clampRatio", () => {
  it("clamps below minimum to 0.01", () => {
    expect(clampRatio(0.001)).toBe(0.01);
    expect(clampRatio(0)).toBe(0.01);
    expect(clampRatio(-5)).toBe(0.01);
  });

  it("clamps above maximum to 10", () => {
    expect(clampRatio(15)).toBe(10);
    expect(clampRatio(100)).toBe(10);
  });

  it("passes through values in range", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(1.0)).toBe(1.0);
    expect(clampRatio(5.0)).toBe(5.0);
  });
});

describe("computeModelCalibration", () => {
  it("computes correct ratios", () => {
    const cal = computeModelCalibration(10000, 5000, 2000, 1000, 500);
    expect(cal.inputRatio).toBeCloseTo(0.2);
    expect(cal.outputRatio).toBeCloseTo(0.2);
    expect(cal.sampleSize).toBe(500);
    expect(cal.confidence).toBe("medium");
  });

  it("handles zero estimated tokens gracefully", () => {
    const cal = computeModelCalibration(0, 0, 1000, 500, 100);
    expect(cal.inputRatio).toBe(1);
    expect(cal.outputRatio).toBe(1);
  });

  it("clamps extreme ratios", () => {
    const cal = computeModelCalibration(1, 1, 100000, 100000, 50);
    expect(cal.inputRatio).toBe(10);
    expect(cal.outputRatio).toBe(10);
  });
});

describe("loadCalibration / saveCalibration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `inferwise-cal-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", async () => {
    const result = await loadCalibration(tmpDir);
    expect(result).toBeNull();
  });

  it("saves and loads valid calibration data", async () => {
    const data: CalibrationData = {
      version: 1,
      calibratedAt: "2026-03-10T00:00:00.000Z",
      models: {
        "anthropic/claude-sonnet-4-20250514": {
          inputRatio: 0.12,
          outputRatio: 0.25,
          sampleSize: 5000,
          confidence: "high",
          actualAvgInput: 1200,
          actualAvgOutput: 2500,
          estimatedAvgInput: 10000,
          estimatedAvgOutput: 10000,
        },
      },
    };

    const filePath = await saveCalibration(data, tmpDir);
    expect(filePath).toContain(".inferwise");

    const loaded = await loadCalibration(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.models["anthropic/claude-sonnet-4-20250514"]?.inputRatio).toBeCloseTo(0.12);
  });

  it("creates .inferwise directory if it doesn't exist", async () => {
    const data: CalibrationData = {
      version: 1,
      calibratedAt: new Date().toISOString(),
      models: {},
    };

    const filePath = await saveCalibration(data, tmpDir);
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as CalibrationData;
    expect(parsed.version).toBe(1);
  });

  it("returns null for invalid JSON", async () => {
    const dir = path.join(tmpDir, ".inferwise");
    await mkdir(dir, { recursive: true });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(dir, "calibration.json"), "not json");

    const result = await loadCalibration(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for invalid schema", async () => {
    const dir = path.join(tmpDir, ".inferwise");
    await mkdir(dir, { recursive: true });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(dir, "calibration.json"), JSON.stringify({ version: 99 }));

    const result = await loadCalibration(tmpDir);
    expect(result).toBeNull();
  });
});
