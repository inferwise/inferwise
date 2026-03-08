#!/usr/bin/env node
/**
 * sync-pricing.ts
 *
 * Syncs pricing data from LiteLLM's community-maintained JSON
 * (https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
 * into our provider JSON files.
 *
 * LiteLLM has 100+ contributors watching pricing pages and updates frequently.
 * This is our primary accuracy mechanism — we source from them rather than
 * maintaining our own web scraper.
 *
 * Usage:
 *   pnpm sync-pricing                  # Sync all providers
 *   pnpm sync-pricing --provider anthropic  # Sync one provider
 *   pnpm sync-pricing --dry-run        # Show diff without writing
 *
 * Run automatically via .github/workflows/sync-pricing.yml (daily at 06:00 UTC).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = join(__dirname, "../packages/pricing-db/providers");
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// --- CLI args ---
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const providerArg = args.find((a) => a.startsWith("--provider="))?.split("=")[1];
const PROVIDERS_TO_SYNC = providerArg ? [providerArg] : ["anthropic", "openai", "google", "xai"];

// --- LiteLLM model entry type (per-token, not per-million) ---
interface LiteLLMEntry {
  litellm_provider?: string;
  mode?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_prompt_caching?: boolean;
  supports_reasoning?: boolean;
  supports_computer_use?: boolean;
}

interface LiteLLMPrices {
  [modelId: string]: LiteLLMEntry;
}

// --- Our provider config (what IDs to map and how) ---
interface ModelSyncConfig {
  /** Our canonical model ID */
  id: string;
  /** LiteLLM key(s) to look up — first match wins */
  litellmKeys: string[];
  /** Keep these fields from our existing JSON (not overwritten from LiteLLM) */
  preserveFields?: string[];
}

const SYNC_CONFIG: Record<string, ModelSyncConfig[]> = {
  anthropic: [
    { id: "claude-opus-4-6", litellmKeys: ["claude-opus-4-6"] },
    { id: "claude-sonnet-4-6", litellmKeys: ["claude-sonnet-4-6"] },
    {
      id: "claude-haiku-4-5-20251001",
      litellmKeys: ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    },
    {
      id: "claude-sonnet-4-5-20250929",
      litellmKeys: ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
    },
    {
      id: "claude-opus-4-5-20251101",
      litellmKeys: ["claude-opus-4-5-20251101", "claude-opus-4-5"],
    },
    {
      id: "claude-opus-4-1-20250805",
      litellmKeys: ["claude-opus-4-1-20250805", "claude-opus-4-1"],
    },
    {
      id: "claude-sonnet-4-20250514",
      litellmKeys: ["claude-sonnet-4-20250514", "claude-sonnet-4-0"],
    },
    {
      id: "claude-opus-4-20250514",
      litellmKeys: ["claude-opus-4-20250514", "claude-opus-4-0"],
    },
    { id: "claude-3-haiku-20240307", litellmKeys: ["claude-3-haiku-20240307"] },
  ],
  openai: [
    { id: "gpt-4o", litellmKeys: ["gpt-4o", "gpt-4o-2024-11-20"] },
    { id: "gpt-4o-mini", litellmKeys: ["gpt-4o-mini", "gpt-4o-mini-2024-07-18"] },
    { id: "o3", litellmKeys: ["o3", "o3-2025-04-16"] },
    { id: "o3-mini", litellmKeys: ["o3-mini", "o3-mini-2025-01-31"] },
    { id: "o4-mini", litellmKeys: ["o4-mini", "o4-mini-2025-04-16"] },
    { id: "o1", litellmKeys: ["o1", "o1-2024-12-17"] },
    { id: "o1-mini", litellmKeys: ["o1-mini", "o1-mini-2024-09-12"] },
    { id: "gpt-4-turbo", litellmKeys: ["gpt-4-turbo", "gpt-4-turbo-2024-04-09"] },
  ],
  google: [
    { id: "gemini-2.5-pro", litellmKeys: ["gemini/gemini-2.5-pro", "gemini-2.5-pro"] },
    { id: "gemini-2.5-flash", litellmKeys: ["gemini/gemini-2.5-flash", "gemini-2.5-flash"] },
    { id: "gemini-2.0-flash", litellmKeys: ["gemini/gemini-2.0-flash", "gemini-2.0-flash"] },
    {
      id: "gemini-2.0-flash-lite",
      litellmKeys: ["gemini/gemini-2.0-flash-lite", "gemini-2.0-flash-lite"],
    },
    {
      id: "gemini-1.5-pro",
      litellmKeys: ["gemini/gemini-1.5-pro", "gemini-1.5-pro", "gemini-1.5-pro-002"],
    },
    {
      id: "gemini-1.5-flash",
      litellmKeys: ["gemini/gemini-1.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-002"],
    },
  ],
  xai: [
    { id: "grok-3", litellmKeys: ["xai/grok-3", "grok-3"] },
    { id: "grok-3-mini", litellmKeys: ["xai/grok-3-mini", "grok-3-mini"] },
    { id: "grok-3-vision", litellmKeys: ["xai/grok-3-vision", "grok-3-vision"] },
    { id: "grok-2", litellmKeys: ["xai/grok-2", "grok-2", "grok-2-1212"] },
    {
      id: "grok-2-vision",
      litellmKeys: ["xai/grok-2-vision", "grok-2-vision", "grok-2-vision-1212"],
    },
  ],
};

// Convert per-token cost to per-million (our format)
function toPerMillion(perToken: number | undefined): number | undefined {
  if (perToken === undefined) return undefined;
  return Math.round(perToken * 1_000_000 * 10000) / 10000; // 4 decimal places
}

function findLiteLLMEntry(prices: LiteLLMPrices, keys: string[]): [string, LiteLLMEntry] | null {
  for (const key of keys) {
    const entry = prices[key];
    if (entry && entry.mode === "chat" && entry.input_cost_per_token !== undefined) {
      return [key, entry];
    }
  }
  return null;
}

interface ExistingModel {
  id: string;
  aliases?: string[];
  status?: string;
  name?: string;
  tier?: string;
  capabilities?: string[];
  knowledge_cutoff?: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_read_input_cost_per_million?: number;
  cache_write_input_cost_per_million?: number;
  batch_input_cost_per_million?: number;
  batch_output_cost_per_million?: number;
  input_cost_above_200k_per_million?: number;
  output_cost_above_200k_per_million?: number;
  context_window: number;
  max_output_tokens: number;
  supports_vision?: boolean;
  supports_tools?: boolean;
  supports_prompt_caching?: boolean;
  supports_reasoning?: boolean;
  supports_computer_use?: boolean;
}

interface ProviderFile {
  provider: string;
  last_updated: string;
  last_verified: string;
  source: string;
  models: ExistingModel[];
}

async function syncProvider(provider: string, prices: LiteLLMPrices): Promise<void> {
  const filePath = join(PROVIDERS_DIR, `${provider}.json`);
  const existing: ProviderFile = JSON.parse(readFileSync(filePath, "utf-8")) as ProviderFile;
  const configs = SYNC_CONFIG[provider] ?? [];
  const today = new Date().toISOString().split("T")[0] as string;

  let updatedCount = 0;
  let notFoundCount = 0;

  const updatedModels = existing.models.map((model) => {
    const config = configs.find((c) => c.id === model.id);
    if (!config) return model; // Model not in sync config — leave unchanged

    const found = findLiteLLMEntry(prices, config.litellmKeys);
    if (!found) {
      console.warn(
        `  [NOT FOUND] ${model.id} — no matching LiteLLM entry. Keeping existing prices.`,
      );
      notFoundCount++;
      return model;
    }

    const [foundKey, entry] = found;
    const prevInput = model.input_cost_per_million;
    const prevOutput = model.output_cost_per_million;

    const newInput = toPerMillion(entry.input_cost_per_token) ?? model.input_cost_per_million;
    const newOutput = toPerMillion(entry.output_cost_per_token) ?? model.output_cost_per_million;

    const changed = newInput !== prevInput || newOutput !== prevOutput;
    if (changed) {
      console.log(
        `  [UPDATED] ${model.id} (from ${foundKey})` +
          `\n    input:  $${prevInput} → $${newInput} /MTok` +
          `\n    output: $${prevOutput} → $${newOutput} /MTok`,
      );
      updatedCount++;
    }

    const updated: ExistingModel = {
      ...model,
      input_cost_per_million: newInput,
      output_cost_per_million: newOutput,
    };

    // Update optional pricing fields if present in LiteLLM
    const cacheRead = toPerMillion(entry.cache_read_input_token_cost);
    if (cacheRead !== undefined) updated.cache_read_input_cost_per_million = cacheRead;

    const cacheWrite = toPerMillion(entry.cache_creation_input_token_cost);
    if (cacheWrite !== undefined) updated.cache_write_input_cost_per_million = cacheWrite;

    const above200kInput = toPerMillion(entry.input_cost_per_token_above_200k_tokens);
    if (above200kInput !== undefined) updated.input_cost_above_200k_per_million = above200kInput;

    const above200kOutput = toPerMillion(entry.output_cost_per_token_above_200k_tokens);
    if (above200kOutput !== undefined) updated.output_cost_above_200k_per_million = above200kOutput;

    // Context window
    if (entry.max_input_tokens) updated.context_window = entry.max_input_tokens;
    if (entry.max_output_tokens) updated.max_output_tokens = entry.max_output_tokens;

    // Capability flags
    if (entry.supports_vision !== undefined) updated.supports_vision = entry.supports_vision;
    if (entry.supports_function_calling !== undefined)
      updated.supports_tools = entry.supports_function_calling;
    if (entry.supports_prompt_caching !== undefined)
      updated.supports_prompt_caching = entry.supports_prompt_caching;
    if (entry.supports_reasoning !== undefined)
      updated.supports_reasoning = entry.supports_reasoning;
    if (entry.supports_computer_use !== undefined)
      updated.supports_computer_use = entry.supports_computer_use;

    return updated;
  });

  const output: ProviderFile = {
    ...existing,
    last_updated: today,
    models: updatedModels,
  };

  console.log(
    `  ${provider}: ${updatedCount} price updates, ${notFoundCount} models not in LiteLLM`,
  );

  if (!isDryRun) {
    writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
    console.log(`  Written: ${filePath}`);
  } else {
    console.log("  [DRY RUN] No files written.");
  }
}

async function main(): Promise<void> {
  console.log(`Fetching LiteLLM pricing from:\n  ${LITELLM_URL}\n`);

  const response = await fetch(LITELLM_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch LiteLLM prices: ${response.status} ${response.statusText}`);
  }

  const prices = (await response.json()) as LiteLLMPrices;
  console.log(`Fetched ${Object.keys(prices).length} model entries from LiteLLM.\n`);

  for (const provider of PROVIDERS_TO_SYNC) {
    console.log(`Syncing ${provider}...`);
    await syncProvider(provider, prices);
    console.log();
  }

  if (!isDryRun) {
    console.log("Done. Commit these changes:");
    console.log("  git add packages/pricing-db/providers/");
    console.log(`  git commit -m "chore(pricing): sync from litellm $(date +%Y-%m-%d)"`);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
