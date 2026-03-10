import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const overrideSchema = z.object({
  pattern: z.string(),
  volume: z.number().positive().optional(),
});

const configSchema = z.object({
  defaultVolume: z.number().positive().optional(),
  ignore: z.array(z.string()).optional(),
  overrides: z.array(overrideSchema).optional(),
  apiUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

export type InferwiseConfig = z.infer<typeof configSchema>;

const CONFIG_FILENAME = "inferwise.config.json";

/** Search for inferwise.config.json from startDir up to filesystem root. */
async function findConfigFile(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME);
    try {
      await readFile(candidate, "utf-8");
      return candidate;
    } catch {
      // File doesn't exist at this level — go up
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Parse and validate config JSON, throwing a helpful error on invalid input. */
function parseConfig(raw: string, filePath: string): InferwiseConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config in ${filePath}:\n${issues}`);
  }

  return result.data;
}

/**
 * Load inferwise.config.json.
 * - If configPath provided, reads that file directly.
 * - INFERWISE_CONFIG env var overrides auto-discovery.
 * - Otherwise walks up from CWD looking for inferwise.config.json.
 * - Returns {} if no file found (zero config to start).
 */
export async function loadConfig(configPath?: string): Promise<InferwiseConfig> {
  const resolvedPath = configPath ?? process.env.INFERWISE_CONFIG;

  if (resolvedPath) {
    const resolved = path.resolve(resolvedPath);
    const raw = await readFile(resolved, "utf-8");
    return parseConfig(raw, resolved);
  }

  const found = await findConfigFile(process.cwd());
  if (!found) return {};

  const raw = await readFile(found, "utf-8");
  return parseConfig(raw, found);
}

/**
 * Resolve the default daily volume from INFERWISE_VOLUME env var.
 * Returns undefined if not set or invalid.
 */
export function getEnvVolume(): number | undefined {
  const raw = process.env.INFERWISE_VOLUME;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return undefined;
  return parsed;
}

/** Check if a file path matches a glob-like pattern (simple prefix + wildcard). */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize separators to forward slashes for consistent matching
  const normalized = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob pattern to regex
  const regexStr = normalizedPattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalized);
}

/** Find the first matching override for a file path. */
function findOverride(
  overrides: InferwiseConfig["overrides"],
  filePath: string,
): z.infer<typeof overrideSchema> | undefined {
  if (!overrides) return undefined;
  return overrides.find((o) => matchesPattern(filePath, o.pattern));
}

/**
 * Resolve the daily request volume for a given file.
 * Priority: CLI explicit flag > matching override > config default > fallback.
 */
export function resolveVolume(
  config: InferwiseConfig,
  filePath: string,
  cliVolume: number,
  cliVolumeExplicit: boolean,
): number {
  if (cliVolumeExplicit) return cliVolume;

  const override = findOverride(config.overrides, filePath);
  if (override?.volume) return override.volume;

  if (config.defaultVolume) return config.defaultVolume;

  return cliVolume;
}
