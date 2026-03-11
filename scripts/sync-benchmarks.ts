#!/usr/bin/env node
/**
 * sync-benchmarks.ts
 *
 * Syncs quality benchmark data from Chatbot Arena (LMSYS) into our
 * benchmarks.json file. Arena publishes human-preference Elo rankings
 * via a HuggingFace Spaces Gradio API.
 *
 * We fetch per-category leaderboard data, map Arena model names to our
 * canonical `provider/model-id` keys, and normalize ranks to 0-100 scores.
 *
 * Usage:
 *   pnpm sync-benchmarks                  # Sync all
 *   pnpm sync-benchmarks --dry-run        # Show diff without writing
 *
 * Run automatically via .github/workflows/sync-benchmarks.yml (weekly).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_PATH = join(__dirname, "../packages/pricing-db/benchmarks.json");

// --- CLI args ---
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// --- Arena API ---
// Chatbot Arena publishes leaderboard data via the lmarena.ai API.
// The full leaderboard table is available as JSON from their Gradio Space.
const ARENA_API_URL = "https://lmarena.ai/api/v1/leaderboard";

// Fallback: HuggingFace Spaces Gradio API endpoint
const ARENA_HF_API_URL = "https://lmarena-ai-chatbot-arena-leaderboard.hf.space/api/predict";

// --- Category endpoints ---
// Arena exposes per-category rankings. We fetch overall + subcategories.
type ArenaCategory = "overall" | "coding" | "hard_prompts" | "math" | "creative_writing" | "if";

const CATEGORY_MAP: Record<ArenaCategory, string> = {
  overall: "overall",
  coding: "coding",
  hard_prompts: "reasoning",
  math: "math",
  creative_writing: "creative_writing",
  if: "instruction_following",
};

// --- Model name mapping ---
// Maps Arena display names to our canonical `provider/model-id` keys.
// Arena names are inconsistent — some have versions, some don't.
const MODEL_NAME_MAP: Record<string, string> = {
  // Anthropic
  "claude-opus-4-6": "anthropic/claude-opus-4-6",
  "claude-opus-4-20250514": "anthropic/claude-opus-4-20250514",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4-5-20251001",
  "claude-3.5-haiku-20241022": "anthropic/claude-3-5-haiku-20241022",
  "claude-3-5-haiku-20241022": "anthropic/claude-3-5-haiku-20241022",

  // OpenAI
  "gpt-4o-2024-11-20": "openai/gpt-4o",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini-2024-07-18": "openai/gpt-4o-mini",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-4.1": "openai/gpt-4.1",
  "gpt-4.1-2025-04-14": "openai/gpt-4.1",
  "gpt-4.1-mini": "openai/gpt-4.1-mini",
  "gpt-4.1-mini-2025-04-14": "openai/gpt-4.1-mini",
  "gpt-4.1-nano": "openai/gpt-4.1-nano",
  "gpt-4.1-nano-2025-04-14": "openai/gpt-4.1-nano",
  "o3-2025-04-16": "openai/o3",
  o3: "openai/o3",
  "o3-mini": "openai/o3-mini",
  "o3-mini-high": "openai/o3-mini",
  "o4-mini-2025-04-16": "openai/o4-mini",
  "o4-mini": "openai/o4-mini",

  // Google
  "gemini-2.0-flash": "google/gemini-2.0-flash",
  "gemini-2.0-flash-001": "google/gemini-2.0-flash",
  "gemini-2.0-flash-lite": "google/gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001": "google/gemini-2.0-flash-lite",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "gemini-2.5-flash-preview-04-17": "google/gemini-2.5-flash",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-pro-preview-03-25": "google/gemini-2.5-pro",
  "gemini-3-flash-preview": "google/gemini-3-flash-preview",
  "gemini-3-flash": "google/gemini-3-flash-preview",
  "gemini-3.1-pro-preview": "google/gemini-3.1-pro-preview",
  "gemini-3.1-pro": "google/gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview": "google/gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite-preview",

  // xAI
  "grok-3-preview-02-24": "xai/grok-3",
  "grok-3": "xai/grok-3",
  "grok-3-mini-beta": "xai/grok-3-mini",
  "grok-3-mini": "xai/grok-3-mini",
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

// --- Arena data fetching ---

interface ArenaLeaderboardResponse {
  results?: Array<{
    model?: string;
    name?: string;
    rank?: number;
    elo?: number;
    rating?: number;
  }>;
  data?: unknown[][];
  total?: number;
}

/**
 * Try fetching from the Arena API. Falls back to scraping approach if needed.
 * Returns an array of { name, rank, elo } per category.
 */
async function fetchArenaCategory(
  category: ArenaCategory,
): Promise<{ entries: ArenaEntry[]; total: number }> {
  // Try the main API first
  const categoryParam = category === "overall" ? "" : `?category=${category}`;
  const url = `${ARENA_API_URL}${categoryParam}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const data = (await response.json()) as ArenaLeaderboardResponse;
      if (data.results && data.results.length > 0) {
        const entries: ArenaEntry[] = data.results
          .filter((r) => (r.model || r.name) !== undefined && r.rank !== undefined)
          .map((r) => ({
            name: (r.model ?? r.name) as string,
            rank: r.rank as number,
            elo: r.elo ?? r.rating,
          }));
        return { entries, total: data.total ?? entries.length };
      }
    }
  } catch {
    // Fall through to HuggingFace fallback
  }

  // Fallback: HuggingFace Spaces Gradio API
  try {
    const response = await fetch(ARENA_HF_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [category === "overall" ? "Overall" : category],
        fn_index: 0,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as ArenaLeaderboardResponse;
      if (data.data && Array.isArray(data.data) && data.data.length > 0) {
        const entries: ArenaEntry[] = [];
        for (const row of data.data) {
          if (!Array.isArray(row) || row.length < 3) continue;
          const rank = typeof row[0] === "number" ? row[0] : undefined;
          const name = typeof row[1] === "string" ? row[1] : undefined;
          const elo = typeof row[2] === "number" ? row[2] : undefined;
          if (rank !== undefined && name) {
            entries.push({ name, rank, elo });
          }
        }
        return { entries, total: entries.length };
      }
    }
  } catch {
    // Fall through
  }

  console.warn(`  [WARN] Could not fetch Arena data for category: ${category}`);
  return { entries: [], total: 0 };
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
  console.log("Fetching Chatbot Arena leaderboard data...\n");

  // Load existing benchmarks
  const existing: BenchmarkData = JSON.parse(
    readFileSync(BENCHMARKS_PATH, "utf-8"),
  ) as BenchmarkData;

  // Fetch each category
  const categoryData: Record<ArenaCategory, { entries: ArenaEntry[]; total: number }> = {
    overall: { entries: [], total: 0 },
    coding: { entries: [], total: 0 },
    hard_prompts: { entries: [], total: 0 },
    math: { entries: [], total: 0 },
    creative_writing: { entries: [], total: 0 },
    if: { entries: [], total: 0 },
  };

  const categories: ArenaCategory[] = [
    "overall",
    "coding",
    "hard_prompts",
    "math",
    "creative_writing",
    "if",
  ];

  for (const cat of categories) {
    console.log(`  Fetching ${cat}...`);
    categoryData[cat] = await fetchArenaCategory(cat);
    console.log(`    → ${categoryData[cat].entries.length} models`);
  }

  const totalModels = categoryData.overall.total || categoryData.overall.entries.length;

  if (totalModels === 0) {
    console.error("\nError: Could not fetch any Arena data. API may be unavailable.");
    console.error("Keeping existing benchmarks.json unchanged.");
    process.exit(0);
  }

  console.log(`\nTotal models ranked: ${totalModels}\n`);

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

    const overallEntry = findArenaEntry(categoryData.overall.entries, canonId);

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

    const overallTotal = categoryData.overall.total || categoryData.overall.entries.length;
    const entry: BenchmarkEntry = {
      overall: normalizeRank(overallEntry.rank, overallTotal),
      primary_source: "chatbot-arena",
    };

    if (overallEntry.elo) entry.arena_elo = overallEntry.elo;
    entry.arena_rank = overallEntry.rank;

    // Fill subcategory scores
    for (const cat of categories) {
      if (cat === "overall") continue;
      const catTotal = categoryData[cat].total || categoryData[cat].entries.length;
      if (catTotal === 0) continue;

      const catEntry = findArenaEntry(categoryData[cat].entries, canonId);
      if (catEntry) {
        const field = CATEGORY_MAP[cat] as keyof BenchmarkEntry;
        (entry as Record<string, unknown>)[field] = normalizeRank(catEntry.rank, catTotal);
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
