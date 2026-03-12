/**
 * Core logic for applying model swap recommendations to source files.
 * Shared between the `inferwise fix` CLI command and the MCP `apply_recommendations` tool.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ModelSwap {
  file: string;
  line: number;
  currentModel: string;
  suggestedModel: string;
  monthlySavings?: number;
}

export interface AppliedSwap {
  file: string;
  line: number;
  from: string;
  to: string;
}

export interface SkippedSwap {
  file: string;
  line: number;
  from: string;
  to: string;
  reason: string;
}

export interface ApplyResult {
  applied: AppliedSwap[];
  skipped: SkippedSwap[];
  totalApplied: number;
  totalSkipped: number;
  estimatedMonthlySavings: number;
}

/**
 * Apply a single model swap to a source file.
 * Returns the updated file content, or null if the swap could not be applied.
 */
export function applyModelSwap(
  fileContent: string,
  lineNumber: number,
  currentModel: string,
  suggestedModel: string,
): { content: string; reason?: string } | null {
  const lines = fileContent.split("\n");
  const lineIndex = lineNumber - 1;

  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }

  const line = lines[lineIndex] ?? "";

  // Check if the current model appears as a string literal on this line
  // Match both single and double quotes, and backtick templates
  const patterns = [`"${currentModel}"`, `'${currentModel}'`, `\`${currentModel}\``];

  let found = false;
  let updatedLine = line;

  for (const pattern of patterns) {
    if (line.includes(pattern)) {
      const quote = pattern[0];
      updatedLine = line.replace(pattern, `${quote}${suggestedModel}${quote}`);
      found = true;
      break;
    }
  }

  if (!found) {
    return null;
  }

  lines[lineIndex] = updatedLine;
  return { content: lines.join("\n") };
}

/**
 * Apply multiple model swaps to source files.
 * Groups swaps by file to minimize file reads/writes.
 */
export async function applyRecommendations(
  swaps: ModelSwap[],
  basePath: string,
  dryRun: boolean,
): Promise<ApplyResult> {
  const applied: AppliedSwap[] = [];
  const skipped: SkippedSwap[] = [];
  let totalSavings = 0;

  // Group swaps by file, sorted by line number descending
  // (apply from bottom to top so line numbers don't shift)
  const byFile = new Map<string, ModelSwap[]>();
  for (const swap of swaps) {
    const key = swap.file;
    const group = byFile.get(key) ?? [];
    group.push(swap);
    byFile.set(key, group);
  }

  for (const [file, fileSwaps] of byFile) {
    const filePath = path.isAbsolute(file) ? file : path.resolve(basePath, file);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      for (const swap of fileSwaps) {
        skipped.push({
          file: swap.file,
          line: swap.line,
          from: swap.currentModel,
          to: swap.suggestedModel,
          reason: "File not found or not readable",
        });
      }
      continue;
    }

    // Sort by line number descending so replacements don't shift line numbers
    const sorted = [...fileSwaps].sort((a, b) => b.line - a.line);

    let modified = false;
    for (const swap of sorted) {
      const result = applyModelSwap(content, swap.line, swap.currentModel, swap.suggestedModel);

      if (result) {
        content = result.content;
        modified = true;
        applied.push({
          file: swap.file,
          line: swap.line,
          from: swap.currentModel,
          to: swap.suggestedModel,
        });
        totalSavings += swap.monthlySavings ?? 0;
      } else {
        skipped.push({
          file: swap.file,
          line: swap.line,
          from: swap.currentModel,
          to: swap.suggestedModel,
          reason:
            "Model string not found as literal on expected line (may be dynamic or file changed)",
        });
      }
    }

    if (modified && !dryRun) {
      await writeFile(filePath, content, "utf-8");
    }
  }

  return {
    applied,
    skipped,
    totalApplied: applied.length,
    totalSkipped: skipped.length,
    estimatedMonthlySavings: totalSavings,
  };
}
