import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type Confidence = "low" | "medium" | "high";

const modelCalibrationSchema = z.object({
  inputRatio: z.number().min(0.001).max(100),
  outputRatio: z.number().min(0.001).max(100),
  sampleSize: z.number().int().min(0),
  confidence: z.enum(["low", "medium", "high"]),
  actualAvgInput: z.number().min(0),
  actualAvgOutput: z.number().min(0),
  estimatedAvgInput: z.number().min(0),
  estimatedAvgOutput: z.number().min(0),
});

const calibrationDataSchema = z.object({
  version: z.literal(1),
  calibratedAt: z.string(),
  models: z.record(z.string(), modelCalibrationSchema),
});

export interface ModelCalibration {
  inputRatio: number;
  outputRatio: number;
  sampleSize: number;
  confidence: "low" | "medium" | "high";
  actualAvgInput: number;
  actualAvgOutput: number;
  estimatedAvgInput: number;
  estimatedAvgOutput: number;
}

export interface CalibrationData {
  version: 1;
  calibratedAt: string;
  models: Record<string, ModelCalibration>;
}

const CALIBRATION_DIR = ".inferwise";
const CALIBRATION_FILE = "calibration.json";

/** Derive confidence from request sample size. */
export function computeConfidence(sampleSize: number): Confidence {
  if (sampleSize >= 1000) return "high";
  if (sampleSize >= 100) return "medium";
  return "low";
}

/** Clamp a ratio to [0.001, 100.0] to prevent nonsensical corrections. */
export function clampRatio(ratio: number): number {
  return Math.max(0.001, Math.min(100, ratio));
}

/** Compute calibration factors for a single model. */
export function computeModelCalibration(
  estimatedAvgInput: number,
  estimatedAvgOutput: number,
  actualAvgInput: number,
  actualAvgOutput: number,
  sampleSize: number,
): ModelCalibration {
  const rawInputRatio = estimatedAvgInput > 0 ? actualAvgInput / estimatedAvgInput : 1;
  const rawOutputRatio = estimatedAvgOutput > 0 ? actualAvgOutput / estimatedAvgOutput : 1;

  return {
    inputRatio: clampRatio(rawInputRatio),
    outputRatio: clampRatio(rawOutputRatio),
    sampleSize,
    confidence: computeConfidence(sampleSize),
    actualAvgInput,
    actualAvgOutput,
    estimatedAvgInput,
    estimatedAvgOutput,
  };
}

/** Resolve the .inferwise directory path from a project root. */
function calibrationPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), CALIBRATION_DIR, CALIBRATION_FILE);
}

/** Load calibration data from .inferwise/calibration.json. Returns null if not found or invalid. */
export async function loadCalibration(projectRoot?: string): Promise<CalibrationData | null> {
  const filePath = calibrationPath(projectRoot ?? process.cwd());
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const result = calibrationDataSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

/** Save calibration data to .inferwise/calibration.json. Creates directory if needed. */
export async function saveCalibration(
  data: CalibrationData,
  projectRoot?: string,
): Promise<string> {
  const filePath = calibrationPath(projectRoot ?? process.cwd());
  const dirPath = path.dirname(filePath);
  await mkdir(dirPath, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}
