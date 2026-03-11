#!/usr/bin/env node
/**
 * sync-benchmarks.ts
 *
 * Syncs quality benchmark data from Chatbot Arena (LMSYS) into our
 * benchmarks.json file. Arena per-category Elo rankings are only available
 * in Python pickle files on HuggingFace — so we shell out to a Python
 * helper script (fetch-arena-elo.py) that downloads the pickle and
 * outputs JSON to stdout.
 *
 * We then map Arena model names to our canonical `provider/model-id` keys,
 * normalize ranks to 0-100 scores, and write benchmarks.json.
 *
 * Usage:
 *   pnpm sync-benchmarks                  # Sync all
 *   pnpm sync-benchmarks --dry-run        # Show diff without writing
 *
 * Run automatically via .github/workflows/sync-benchmarks.yml (weekly).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_PATH = join(__dirname, "../packages/pricing-db/benchmarks.json");
const PYTHON_SCRIPT = join(__dirname, "fetch-arena-elo.py");

// --- CLI args ---
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// --- Our benchmark category names (output from Python script) ---
type BenchmarkCategory =
  | "overall"
  | "coding"
  | "reasoning"
  | "math"
  | "creative_writing"
  | "instruction_following";

const ALL_CATEGORIES: BenchmarkCategory[] = [
  "overall",
  "coding",
  "reasoning",
  "math",
  "creative_writing",
  "instruction_following",
];

// --- Model name mapping ---
// Maps Arena display names to our canonical `provider/model-id` keys.
// Arena names are inconsistent — some have versions, some don't.
// Maps Arena display names (from pickle) to our canonical `provider/model-id` keys.
// These names come from the actual Arena leaderboard data, not documentation.
// Run `python scripts/fetch-arena-elo.py | grep -i claude` to discover new names.
const MODEL_NAME_MAP: Record<string, string> = {
  // Anthropic — Arena uses dated IDs
  "claude-opus-4-1-20250805": "anthropic/claude-opus-4-6",
  "claude-opus-4-20250514": "anthropic/claude-opus-4-20250514",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4-20250514",
  "claude-3-5-haiku-20241022": "anthropic/claude-haiku-4-5-20251001",

  // OpenAI — Arena uses dated IDs
  "gpt-4o-2024-05-13": "openai/gpt-4o",
  "gpt-4o-2024-08-06": "openai/gpt-4o",
  "gpt-4o-mini-2024-07-18": "openai/gpt-4o-mini",
  "gpt-4.1-2025-04-14": "openai/gpt-4.1",
  "gpt-4.1-mini-2025-04-14": "openai/gpt-4.1-mini",
  "gpt-4.1-nano-2025-04-14": "openai/gpt-4.1-nano",
  "o3-2025-04-16": "openai/o3",
  "o3-mini": "openai/o3-mini",
  "o3-mini-high": "openai/o3-mini",
  "o4-mini-2025-04-16": "openai/o4-mini",

  // Google — Arena uses versioned IDs
  "gemini-2.0-flash-001": "google/gemini-2.0-flash",
  "gemini-2.0-flash-lite-preview-02-05": "google/gemini-2.0-flash-lite",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  // Gemini 3.x not yet on Arena — will be picked up when they appear

  // xAI
  "grok-3-preview-02-24": "xai/grok-3",
  "grok-3-mini-beta": "xai/grok-3-mini",
  "grok-3-mini-high": "xai/grok-3-mini",
};

// Models that share scores with another entry (aliases / vision variants)
const SCORE_ALIASES: Record<string, string> = {
  "anthropic/claude-3-5-haiku-20241022": "anthropic/claude-haiku-4-5-20251001",
  "xai/grok-3-vision": "xai/grok-3",
  "google/gemini-2.5-flash-lite": "google/gemini-2.0-flash-lite",
};

// Models where we provide estimates (not on Arena)
const ESTIMATED_MODELS: Record<string, Record<string, number>> = {
  "perplexity/sonar": {
    overall: 70,
    coding: 65,
    reasoning: 68,
    creative_writing: 72,
    instruction_following: 70,
  },
  "perplexity/sonar-pro": {
    overall: 78,
    coding: 72,
    reasoning: 76,
    creative_writing: 78,
    instruction_following: 76,
  },
  "perplexity/sonar-reasoning-pro": {
    overall: 82,
    coding: 76,
    reasoning: 84,
    creative_writing: 78,
    instruction_following: 80,
  },
  "perplexity/sonar-deep-research": {
    overall: 82,
    coding: 76,
    reasoning: 84,
    creative_writing: 78,
    instruction_following: 80,
  },
};

// --- Types ---
interface ArenaEntry {
  name: string;
  rank: number;
  elo?: number;
}

interface ArenaData {
  total_models: number;
  categories: Record<string, ArenaEntry[]>;
}

interface BenchmarkEntry {
  overall: number;
  coding?: number;
  reasoning?: number;
  math?: number;
  creative_writing?: number;
  instruction_following?: number;
  arena_elo?: number;
  arena_rank?: number;
  primary_source: string;
  note?: string;
}

interface BenchmarkData {
  version: 1;
  last_updated: string;
  total_models_ranked: number;
  sources: Array<{ name: string; url: string; description: string }>;
  models: Record<string, BenchmarkEntry>;
}

// --- Normalization ---
function normalizeRank(rank: number, totalModels: number): number {
  if (totalModels <= 1) return 100;
  return Math.round((1 - (rank - 1) / (totalModels - 1)) * 100);
}

// --- Arena data fetching via Python subprocess ---

function fetchArenaData(): ArenaData | null {
  // Try python3 first (Linux/macOS), then python (Windows)
  const pythonCandidates = ["python3", "python"];

  for (const pythonCmd of pythonCandidates) {
    try {
      const stdout = execFileSync(pythonCmd, [PYTHON_SCRIPT], {
        encoding: "utf-8",
        timeout: 120_000, // 2 minutes for download + processing
        maxBuffer: 50 * 1024 * 1024, // 50MB (pickle can be large)
        stdio: ["pipe", "pipe", "inherit"], // stderr → console
      });

      const data = JSON.parse(stdout) as ArenaData;
      if (data.categories && data.total_models > 0) {
        return data;
      }

      console.warn("Python script returned empty data.");
      return null;
    } catch (err: unknown) {
      const errObj = err as { message?: string; stderr?: string; status?: number };
      const msg = errObj.message ?? String(err);
      const stderr = errObj.stderr ?? "";
      const combined = `${msg}\n${stderr}`;
      // If the command wasn't found, try next candidate
      // Windows python3 stub says "Python was not found", Unix gives ENOENT
      // Windows may also return exit code 9009 for missing commands
      if (
        combined.includes("ENOENT") ||
        combined.includes("not found") ||
        combined.includes("was not found") ||
        errObj.status === 9009
      ) {
        continue;
      }
      // Other error (timeout, parse failure, script error)
      console.error(`Python script failed with ${pythonCmd}: ${msg}`);
      return null;
    }
  }

  console.error("Python not found. Install Python 3.10+ with pandas to sync Arena data.");
  return null;
}

function findArenaEntry(entries: ArenaEntry[], canonicalId: string): ArenaEntry | undefined {
  // Find all Arena names that map to this canonical ID
  const arenaNames: string[] = [];
  for (const [arenaName, mapId] of Object.entries(MODEL_NAME_MAP)) {
    if (mapId === canonicalId) {
      arenaNames.push(arenaName.toLowerCase());
    }
  }

  // Also try the bare model ID (without provider prefix)
  const bareId = canonicalId.split("/")[1];
  if (bareId) arenaNames.push(bareId.toLowerCase());

  for (const entry of entries) {
    const entryName = entry.name.toLowerCase().trim();
    if (arenaNames.includes(entryName)) return entry;
  }

  return undefined;
}

async function main(): Promise<void> {
  console.log("Syncing Chatbot Arena benchmark data...\n");
  console.log("Step 1: Fetching Arena Elo data via Python helper...\n");

  // Load existing benchmarks
  const existing: BenchmarkData = JSON.parse(
    readFileSync(BENCHMARKS_PATH, "utf-8"),
  ) as BenchmarkData;

  const arenaData = fetchArenaData();

  if (!arenaData) {
    console.error("\nCould not fetch Arena data. Keeping existing benchmarks.json unchanged.");
    process.exit(0);
  }

  const totalModels = arenaData.total_models;
  console.log(
    `\nStep 2: Processing ${totalModels} models across ${Object.keys(arenaData.categories).length} categories...\n`,
  );

  // Build per-category entry maps
  const categoryEntries: Record<string, ArenaEntry[]> = arenaData.categories;

  // Build updated models map
  const updatedModels: Record<string, BenchmarkEntry> = {};
  let updatedCount = 0;
  let unchangedCount = 0;
  let notFoundCount = 0;

  // Get all canonical IDs we track (from existing + MODEL_NAME_MAP targets)
  const canonicalIds = new Set<string>([
    ...Object.keys(existing.models),
    ...Object.values(MODEL_NAME_MAP),
  ]);

  for (const canonId of canonicalIds) {
    // Skip estimated models — they don't come from Arena
    if (canonId in ESTIMATED_MODELS) continue;

    // Skip alias models — they'll be filled from their source
    if (canonId in SCORE_ALIASES) continue;

    const overallEntries = categoryEntries.overall ?? [];
    const overallEntry = findArenaEntry(overallEntries, canonId);

    if (!overallEntry) {
      // Keep existing data if we have it
      const prev = existing.models[canonId];
      if (prev) {
        updatedModels[canonId] = prev;
        notFoundCount++;
        console.log(`  [NOT FOUND] ${canonId} — keeping existing scores`);
      }
      continue;
    }

    const entry: BenchmarkEntry = {
      overall: normalizeRank(overallEntry.rank, totalModels),
      primary_source: "chatbot-arena",
    };

    if (overallEntry.elo) entry.arena_elo = overallEntry.elo;
    entry.arena_rank = overallEntry.rank;

    // Fill subcategory scores
    for (const cat of ALL_CATEGORIES) {
      if (cat === "overall") continue;
      const catEntries = categoryEntries[cat];
      if (!catEntries || catEntries.length === 0) continue;

      const catEntry = findArenaEntry(catEntries, canonId);
      if (catEntry) {
        (entry as Record<string, unknown>)[cat] = normalizeRank(catEntry.rank, catEntries.length);
      }
    }

    // Check if scores changed
    const prev = existing.models[canonId];
    const changed =
      !prev ||
      prev.overall !== entry.overall ||
      prev.coding !== entry.coding ||
      prev.reasoning !== entry.reasoning;

    if (changed) {
      console.log(
        `  [UPDATED] ${canonId}: overall ${prev?.overall ?? "?"} → ${entry.overall}, rank #${entry.arena_rank}`,
      );
      updatedCount++;
    } else {
      unchangedCount++;
    }

    updatedModels[canonId] = entry;
  }

  // Add alias models (copy scores from source)
  for (const [aliasId, sourceId] of Object.entries(SCORE_ALIASES)) {
    const source = updatedModels[sourceId] ?? existing.models[sourceId];
    if (source) {
      updatedModels[aliasId] = {
        ...source,
        note: `Uses ${sourceId.split("/")[1]} scores (same model, older ID)`,
      };
    } else if (existing.models[aliasId]) {
      updatedModels[aliasId] = existing.models[aliasId] as BenchmarkEntry;
    }
  }

  // Add estimated models
  for (const [modelId, scores] of Object.entries(ESTIMATED_MODELS)) {
    updatedModels[modelId] = {
      ...(scores as Record<string, number>),
      overall: scores.overall as number,
      primary_source: "estimate",
      note: "Not ranked on Arena. Estimated from similar-tier models.",
    };
  }

  // Also preserve any existing legacy model entries not in our map
  for (const [modelId, entry] of Object.entries(existing.models)) {
    if (!(modelId in updatedModels)) {
      const existingEntry = entry as BenchmarkEntry;
      // Keep if it has a note about being a proxy or legacy
      if (existingEntry.note) {
        updatedModels[modelId] = existingEntry;
      }
    }
  }

  const today = new Date().toISOString().split("T")[0] as string;

  const output: BenchmarkData = {
    version: 1,
    last_updated: updatedCount > 0 ? today : existing.last_updated,
    total_models_ranked: totalModels,
    sources: [
      {
        name: "chatbot-arena",
        url: "https://arena.ai/leaderboard",
        description: `Human preference rankings from Chatbot Arena (LMSYS). Scores normalized 0-100 from rank position across ${totalModels} models.`,
      },
    ],
    models: updatedModels,
  };

  console.log(
    `\nSummary: ${updatedCount} updated, ${unchangedCount} unchanged, ${notFoundCount} not found on Arena`,
  );
  console.log(`Total models in benchmarks.json: ${Object.keys(updatedModels).length}`);

  if (!isDryRun) {
    writeFileSync(BENCHMARKS_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
    console.log(`\nWritten: ${BENCHMARKS_PATH}`);
  } else {
    console.log("\n[DRY RUN] No files written.");
    if (updatedCount > 0) {
      console.log("Changes that would be written:");
      for (const [id, entry] of Object.entries(updatedModels)) {
        const prev = existing.models[id];
        if (!prev || prev.overall !== entry.overall) {
          console.log(
            `  ${id}: overall ${(prev as BenchmarkEntry | undefined)?.overall ?? "new"} → ${entry.overall}`,
          );
        }
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
