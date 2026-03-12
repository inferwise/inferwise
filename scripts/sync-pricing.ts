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
const PROVIDERS_TO_SYNC = providerArg
  ? [providerArg]
  : ["anthropic", "openai", "google", "xai", "perplexity"];

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
    {
      id: "claude-opus-4-6",
      litellmKeys: ["claude-opus-4-6", "claude-opus-4-6-20260205"],
    },
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
      litellmKeys: ["claude-sonnet-4-20250514", "claude-sonnet-4-0", "claude-4-sonnet-20250514"],
    },
    {
      id: "claude-opus-4-20250514",
      litellmKeys: ["claude-opus-4-20250514", "claude-opus-4-0", "claude-4-opus-20250514"],
    },
    { id: "claude-3-haiku-20240307", litellmKeys: ["claude-3-haiku-20240307"] },
    {
      id: "claude-3-7-sonnet-20250219",
      litellmKeys: ["claude-3-7-sonnet-20250219", "claude-3-7-sonnet"],
    },
    {
      id: "claude-3-5-sonnet-20241022",
      litellmKeys: ["claude-3-5-sonnet-20241022", "claude-3-5-sonnet-v2-20241022"],
    },
    {
      id: "claude-3-5-sonnet-20240620",
      litellmKeys: ["claude-3-5-sonnet-20240620"],
    },
    {
      id: "claude-3-opus-20240229",
      litellmKeys: ["claude-3-opus-20240229"],
    },
    {
      id: "claude-3-sonnet-20240229",
      litellmKeys: ["claude-3-sonnet-20240229"],
    },
    {
      id: "claude-3-5-haiku-20241022",
      litellmKeys: ["claude-3-5-haiku-20241022"],
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      litellmKeys: ["gpt-4o", "gpt-4o-2024-11-20", "gpt-4o-2024-05-13", "gpt-4o-2024-08-06"],
    },
    { id: "gpt-4o-mini", litellmKeys: ["gpt-4o-mini", "gpt-4o-mini-2024-07-18"] },
    { id: "gpt-4.1", litellmKeys: ["gpt-4.1", "gpt-4.1-2025-04-14"] },
    { id: "gpt-4.1-mini", litellmKeys: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14"] },
    { id: "gpt-4.1-nano", litellmKeys: ["gpt-4.1-nano", "gpt-4.1-nano-2025-04-14"] },
    {
      id: "gpt-5",
      litellmKeys: ["gpt-5", "gpt-5-2025-08-07", "gpt-5-chat", "gpt-5-chat-latest"],
    },
    { id: "gpt-5-mini", litellmKeys: ["gpt-5-mini", "gpt-5-mini-2025-08-07"] },
    { id: "gpt-5-nano", litellmKeys: ["gpt-5-nano", "gpt-5-nano-2025-08-07"] },
    {
      id: "gpt-5.1",
      litellmKeys: ["gpt-5.1", "gpt-5.1-2025-11-13", "gpt-5.1-chat-latest"],
    },
    {
      id: "gpt-5.2",
      litellmKeys: ["gpt-5.2", "gpt-5.2-2025-12-11", "gpt-5.2-chat-latest", "gpt-5.3-chat-latest"],
    },
    { id: "gpt-5.4", litellmKeys: ["gpt-5.4", "gpt-5.4-2026-03-05"] },
    {
      id: "gpt-4.5-preview",
      litellmKeys: ["gpt-4.5-preview", "gpt-4.5-preview-2025-02-27"],
    },
    { id: "o3", litellmKeys: ["o3", "o3-2025-04-16"] },
    { id: "o3-mini", litellmKeys: ["o3-mini", "o3-mini-2025-01-31"] },
    { id: "o4-mini", litellmKeys: ["o4-mini", "o4-mini-2025-04-16"] },
    { id: "o1", litellmKeys: ["o1", "o1-2024-12-17"] },
    { id: "o1-mini", litellmKeys: ["o1-mini", "o1-mini-2024-09-12"] },
    { id: "gpt-4-turbo", litellmKeys: ["gpt-4-turbo", "gpt-4-turbo-2024-04-09"] },
  ],
  google: [
    {
      id: "gemini-3.1-pro-preview",
      litellmKeys: [
        "gemini/gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro",
        "gemini/gemini-3.1-pro-preview-customtools",
      ],
    },
    {
      id: "gemini-3-pro-preview",
      litellmKeys: ["gemini/gemini-3-pro-preview", "gemini-3-pro-preview"],
    },
    {
      id: "gemini-3-flash-preview",
      litellmKeys: ["gemini/gemini-3-flash-preview", "gemini-3-flash-preview", "gemini-3-flash"],
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      litellmKeys: [
        "gemini/gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-flash-lite",
      ],
    },
    {
      id: "gemini-2.5-flash-lite",
      litellmKeys: [
        "gemini/gemini-2.5-flash-lite",
        "gemini-2.5-flash-lite",
        "gemini/gemini-2.5-flash-lite-preview-06-17",
        "gemini/gemini-2.5-flash-lite-preview-09-2025",
        "gemini/gemini-flash-lite-latest",
      ],
    },
    {
      id: "gemini-2.5-pro",
      litellmKeys: [
        "gemini/gemini-2.5-pro",
        "gemini-2.5-pro",
        "gemini/gemini-2.5-pro-preview-03-25",
        "gemini/gemini-2.5-pro-preview-05-06",
        "gemini/gemini-2.5-pro-preview-06-05",
        "gemini/gemini-pro-latest",
      ],
    },
    {
      id: "gemini-2.5-flash",
      litellmKeys: [
        "gemini/gemini-2.5-flash",
        "gemini-2.5-flash",
        "gemini/gemini-2.5-flash-preview-05-20",
        "gemini/gemini-2.5-flash-preview-09-2025",
        "gemini/gemini-flash-latest",
      ],
    },
    {
      id: "gemini-2.0-flash",
      litellmKeys: [
        "gemini/gemini-2.0-flash",
        "gemini-2.0-flash",
        "gemini/gemini-2.0-flash-001",
        "gemini/gemini-2.0-flash-preview-image-generation",
      ],
    },
    {
      id: "gemini-2.0-flash-lite",
      litellmKeys: [
        "gemini/gemini-2.0-flash-lite",
        "gemini-2.0-flash-lite",
        "gemini/gemini-2.0-flash-lite-001",
        "gemini/gemini-2.0-flash-lite-preview-02-05",
      ],
    },
    {
      id: "gemini-1.5-pro",
      litellmKeys: [
        "gemini/gemini-1.5-pro",
        "gemini-1.5-pro",
        "gemini-1.5-pro-002",
        "gemini/gemini-1.5-pro-001",
        "gemini/gemini-1.5-pro-latest",
        "gemini/gemini-1.5-pro-exp-0801",
      ],
    },
    {
      id: "gemini-1.5-flash",
      litellmKeys: [
        "gemini/gemini-1.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-002",
        "gemini/gemini-1.5-flash-001",
        "gemini/gemini-1.5-flash-latest",
      ],
    },
  ],
  xai: [
    {
      id: "grok-3",
      litellmKeys: ["xai/grok-3", "grok-3", "grok-3-beta", "grok-3-latest"],
    },
    {
      id: "grok-3-mini",
      litellmKeys: ["xai/grok-3-mini", "grok-3-mini", "grok-3-mini-beta", "grok-3-mini-latest"],
    },
    {
      id: "grok-3-vision",
      litellmKeys: ["xai/grok-3-vision", "grok-3-vision", "grok-vision-beta"],
    },
    {
      id: "grok-2",
      litellmKeys: ["xai/grok-2", "grok-2", "grok-2-1212", "grok-2-latest"],
    },
    {
      id: "grok-2-vision",
      litellmKeys: [
        "xai/grok-2-vision",
        "grok-2-vision",
        "grok-2-vision-1212",
        "grok-2-vision-latest",
      ],
    },
    {
      id: "grok-4",
      litellmKeys: ["xai/grok-4", "grok-4", "grok-4-0709", "grok-4-latest"],
    },
    {
      id: "grok-3-fast",
      litellmKeys: ["xai/grok-3-fast-beta", "grok-3-fast-beta", "grok-3-fast-latest"],
    },
    {
      id: "grok-3-mini-fast",
      litellmKeys: [
        "xai/grok-3-mini-fast",
        "grok-3-mini-fast",
        "grok-3-mini-fast-beta",
        "grok-3-mini-fast-latest",
      ],
    },
    {
      id: "grok-code-fast",
      litellmKeys: [
        "xai/grok-code-fast",
        "grok-code-fast",
        "grok-code-fast-1",
        "grok-code-fast-1-0825",
      ],
    },
    {
      id: "grok-4-fast",
      litellmKeys: [
        "xai/grok-4-fast-reasoning",
        "grok-4-fast-reasoning",
        "grok-4-fast-non-reasoning",
        "grok-4-1-fast",
        "grok-4-1-fast-reasoning",
        "grok-4-1-fast-reasoning-latest",
        "grok-4-1-fast-non-reasoning",
        "grok-4-1-fast-non-reasoning-latest",
      ],
    },
  ],
  perplexity: [
    { id: "sonar-pro", litellmKeys: ["perplexity/sonar-pro", "sonar-pro"] },
    {
      id: "sonar-reasoning-pro",
      litellmKeys: ["perplexity/sonar-reasoning-pro", "sonar-reasoning-pro"],
    },
    {
      id: "sonar-reasoning",
      litellmKeys: ["perplexity/sonar-reasoning", "sonar-reasoning"],
    },
    {
      id: "sonar-deep-research",
      litellmKeys: ["perplexity/sonar-deep-research", "sonar-deep-research"],
    },
    { id: "sonar", litellmKeys: ["perplexity/sonar", "sonar"] },
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

  capabilities?: string[];
  knowledge_cutoff?: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_read_input_cost_per_million?: number;
  cache_write_input_cost_per_million?: number;
  batch_input_cost_per_million?: number;
  batch_output_cost_per_million?: number;
  fast_input_cost_per_million?: number;
  fast_output_cost_per_million?: number;
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
    ...(updatedCount > 0 ? { last_updated: today } : {}),
    last_verified: today,
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

// --- New model discovery ---

/** LiteLLM provider prefixes that map to our provider names. */
const LITELLM_PROVIDER_MAP: Record<string, string[]> = {
  anthropic: ["anthropic"],
  openai: ["openai"],
  google: ["gemini", "vertex_ai", "vertex_ai_beta"],
  xai: ["xai"],
  perplexity: ["perplexity"],
};

/** Model ID patterns to ignore during discovery (non-chat, embedding, deprecated aliases, etc). */
const IGNORE_PATTERNS = [
  // OpenAI noise
  /^ft:/,
  /embed/,
  /tts/,
  /whisper/,
  /dall-e/,
  /realtime/,
  /audio/,
  /computer-use/,
  /moderation/,
  /search/,
  /-image-preview/,
  /gpt-4-\d{4}/,
  /chatgpt-/,

  // Deprecated OpenAI families
  /^gpt-3\.5/,
  /^gpt-4-32k/,
  /^gpt-4(?![\d.o])/,
  /^o1-preview/,

  // Experimental models
  /-exp-/,
  /-thinking-exp/,

  // Google non-production
  /^gemma-/,
  /^learnlm-/,
  /^gemini-pro$/,
  /^gemini-pro-vision$/,
  /^gemini-gemma-/,
  /gemini-1\.5-flash-8b/,
  /gemini-exp-/,
  /gemini-2\.0-pro-exp/,
  /gemini-2\.5-pro-exp/,
  /gemini-2\.0-flash-exp/,
  /gemini-2\.0-flash-live/,
  /gemini-robotics/,
  /gemini-2\.5-flash-preview-04-17/,

  // xAI deprecated
  /^grok-beta$/,
  /^grok-vision-beta$/,

  // Perplexity deprecated / non-sonar
  /pplx-/,
  /codellama-/,
  /llama-2-/,
  /llama-3\.1-(?!sonar)/,
  /sonar-(?:small|medium)-/,
  /sonar-(?:large|huge)-/,
  /mixtral-/,
  /mistral-/,
];

function shouldIgnore(key: string): boolean {
  const bareKey = stripProviderPrefix(key);
  return IGNORE_PATTERNS.some((p) => p.test(key) || p.test(bareKey));
}

/** Strip provider prefix from LiteLLM key to get the bare model ID. */
function stripProviderPrefix(key: string): string {
  return key.replace(
    /^(gemini\/|vertex_ai\/|vertex_ai_beta\/|xai\/|openai\/|anthropic\/|perplexity\/)/,
    "",
  );
}

interface DiscoveredModel {
  litellmKey: string;
  bareId: string;
  inputPerMillion: number;
  outputPerMillion: number;
  contextWindow: number;
  maxOutputTokens: number;
}

function discoverNewModels(provider: string, prices: LiteLLMPrices): DiscoveredModel[] {
  const prefixes = LITELLM_PROVIDER_MAP[provider] ?? [];
  const configs = SYNC_CONFIG[provider] ?? [];

  // Build set of all LiteLLM keys we already track
  const knownKeys = new Set<string>();
  for (const config of configs) {
    for (const key of config.litellmKeys) {
      knownKeys.add(key);
    }
  }

  // Also build set of bare model IDs we track (for fuzzy matching)
  const knownBareIds = new Set<string>();
  for (const config of configs) {
    knownBareIds.add(config.id);
    for (const key of config.litellmKeys) {
      knownBareIds.add(stripProviderPrefix(key));
    }
  }

  const discovered: DiscoveredModel[] = [];
  const seenBareIds = new Set<string>();

  for (const [key, entry] of Object.entries(prices)) {
    // Must be a chat model with pricing
    if (entry.mode !== "chat" || entry.input_cost_per_token === undefined) continue;

    // Must match one of our provider prefixes
    const matchesProvider =
      entry.litellm_provider !== undefined && prefixes.includes(entry.litellm_provider);
    if (!matchesProvider) continue;

    // Skip if already tracked
    if (knownKeys.has(key)) continue;

    // Skip noise
    if (shouldIgnore(key)) continue;

    const bareId = stripProviderPrefix(key);

    // Skip if we already track this bare ID or already discovered it
    if (knownBareIds.has(bareId)) continue;
    if (seenBareIds.has(bareId)) continue;
    seenBareIds.add(bareId);

    const inputPerMillion = toPerMillion(entry.input_cost_per_token) ?? 0;
    const outputPerMillion = toPerMillion(entry.output_cost_per_token) ?? 0;

    discovered.push({
      litellmKey: key,
      bareId,
      inputPerMillion,
      outputPerMillion,
      contextWindow: entry.max_input_tokens ?? 0,
      maxOutputTokens: entry.max_output_tokens ?? entry.max_tokens ?? 0,
    });
  }

  // Sort by output cost descending (most expensive first — likely most important)
  return discovered.sort((a, b) => b.outputPerMillion - a.outputPerMillion);
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

  // --- Discovery report ---
  console.log("=== New Model Discovery ===\n");
  let totalNew = 0;

  for (const provider of PROVIDERS_TO_SYNC) {
    const newModels = discoverNewModels(provider, prices);
    if (newModels.length === 0) {
      console.log(`  ${provider}: No new models found.`);
      continue;
    }

    totalNew += newModels.length;
    console.log(`  ${provider}: ${newModels.length} new model(s) found:`);
    for (const m of newModels) {
      console.log(
        `    [NEW] ${m.bareId}` +
          `  input: $${m.inputPerMillion}/MTok` +
          `  output: $${m.outputPerMillion}/MTok` +
          `  context: ${m.contextWindow}` +
          `  (litellm key: ${m.litellmKey})`,
      );
    }
    console.log();
  }

  if (totalNew > 0) {
    console.log(
      `\n⚠ ${totalNew} new model(s) detected. Add them to SYNC_CONFIG and provider JSON files.`,
    );
    // Write discovery report for CI to pick up
    const reportPath = join(__dirname, "../new-models-report.txt");
    const lines = [
      `${totalNew} new model(s) detected by sync-pricing on ${new Date().toISOString()}\n`,
    ];
    for (const provider of PROVIDERS_TO_SYNC) {
      const newModels = discoverNewModels(provider, prices);
      for (const m of newModels) {
        lines.push(
          `${provider}/${m.bareId} — $${m.inputPerMillion}/$${m.outputPerMillion} per MTok`,
        );
      }
    }
    writeFileSync(reportPath, lines.join("\n"), "utf-8");
    console.log(`Report written to: ${reportPath}`);
  } else {
    console.log("\nAll models up to date — no new models discovered.");
  }

  if (!isDryRun) {
    console.log("\nDone. Commit these changes:");
    console.log("  git add packages/pricing-db/providers/");
    console.log(`  git commit -m "chore(pricing): sync provider pricing $(date +%Y-%m-%d)"`);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});
