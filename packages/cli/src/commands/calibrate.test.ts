import { describe, expect, it } from "vitest";
import { clampRatio, computeConfidence, computeModelCalibration } from "../calibration.js";

describe("calibrate command logic", () => {
  describe("computeConfidence", () => {
    it("returns low for fewer than 100 samples", () => {
      expect(computeConfidence(0)).toBe("low");
      expect(computeConfidence(50)).toBe("low");
      expect(computeConfidence(99)).toBe("low");
    });

    it("returns medium for 100-999 samples", () => {
      expect(computeConfidence(100)).toBe("medium");
      expect(computeConfidence(500)).toBe("medium");
      expect(computeConfidence(999)).toBe("medium");
    });

    it("returns high for 1000+ samples", () => {
      expect(computeConfidence(1000)).toBe("high");
      expect(computeConfidence(50000)).toBe("high");
    });
  });

  describe("clampRatio", () => {
    it("passes through normal ratios unchanged", () => {
      expect(clampRatio(1.0)).toBe(1.0);
      expect(clampRatio(0.5)).toBe(0.5);
      expect(clampRatio(2.0)).toBe(2.0);
    });

    it("clamps extremely low ratios to 0.001", () => {
      expect(clampRatio(0)).toBe(0.001);
      expect(clampRatio(-1)).toBe(0.001);
      expect(clampRatio(0.0001)).toBe(0.001);
    });

    it("clamps extremely high ratios to 100", () => {
      expect(clampRatio(200)).toBe(100);
      expect(clampRatio(1000)).toBe(100);
    });
  });

  describe("computeModelCalibration", () => {
    it("computes correct ratios from actual vs estimated", () => {
      const result = computeModelCalibration(4096, 2048, 2048, 1024, 500);
      expect(result.inputRatio).toBeCloseTo(0.5, 3);
      expect(result.outputRatio).toBeCloseTo(0.5, 3);
      expect(result.sampleSize).toBe(500);
      expect(result.confidence).toBe("medium");
      expect(result.actualAvgInput).toBe(2048);
      expect(result.actualAvgOutput).toBe(1024);
      expect(result.estimatedAvgInput).toBe(4096);
      expect(result.estimatedAvgOutput).toBe(2048);
    });

    it("defaults ratio to 1.0 when estimated is zero", () => {
      const result = computeModelCalibration(0, 0, 500, 200, 1000);
      expect(result.inputRatio).toBe(1);
      expect(result.outputRatio).toBe(1);
    });

    it("clamps extreme ratios", () => {
      // actual is 200x the estimate
      const result = computeModelCalibration(1, 1, 200, 200, 100);
      expect(result.inputRatio).toBe(100);
      expect(result.outputRatio).toBe(100);
    });

    it("preserves all actual/estimated fields", () => {
      const result = computeModelCalibration(3000, 1500, 800, 400, 5000);
      expect(result.actualAvgInput).toBe(800);
      expect(result.actualAvgOutput).toBe(400);
      expect(result.estimatedAvgInput).toBe(3000);
      expect(result.estimatedAvgOutput).toBe(1500);
      expect(result.confidence).toBe("high");
    });

    it("handles equal actual and estimated values", () => {
      const result = computeModelCalibration(1000, 500, 1000, 500, 200);
      expect(result.inputRatio).toBeCloseTo(1.0, 3);
      expect(result.outputRatio).toBeCloseTo(1.0, 3);
    });
  });
});
