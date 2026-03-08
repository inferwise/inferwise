import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Provider } from "@inferwise/pricing-db";
import { glob } from "glob";

export interface ScanResult {
  filePath: string;
  lineNumber: number;
  provider: Provider;
  model: string | null;
  systemPrompt: string | null;
  userPrompt: string | null;
  isDynamic: boolean;
  framework: string;
}

const SUPPORTED_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"];

interface PatternDef {
  regex: RegExp;
  provider: Provider | null; // null = infer from model ID
  framework: string;
}

const PATTERNS: PatternDef[] = [
  // Anthropic SDK (TS/JS and Python)
  { regex: /\.messages\.create\s*\(/, provider: "anthropic", framework: "anthropic-sdk" },
  // OpenAI SDK (TS/JS and Python)
  { regex: /\.chat\.completions\.create\s*\(/, provider: "openai", framework: "openai-sdk" },
  // Google GenAI
  { regex: /\.generateContent\s*\(/, provider: "google", framework: "google-genai" },
  { regex: /genai\.GenerativeModel\s*\(/, provider: "google", framework: "google-genai" },
  { regex: /GenerativeModel\s*\(/, provider: "google", framework: "google-genai" },
  // Vercel AI SDK — provider inferred from model factory
  { regex: /\bgenerateText\s*\(/, provider: null, framework: "vercel-ai-sdk" },
  { regex: /\bstreamText\s*\(/, provider: null, framework: "vercel-ai-sdk" },
  { regex: /\bgenerateObject\s*\(/, provider: null, framework: "vercel-ai-sdk" },
  { regex: /\bstreamObject\s*\(/, provider: null, framework: "vercel-ai-sdk" },
  // LangChain
  { regex: /new\s+ChatAnthropic\s*\(/, provider: "anthropic", framework: "langchain" },
  { regex: /new\s+ChatOpenAI\s*\(/, provider: "openai", framework: "langchain" },
  { regex: /new\s+ChatGoogleGenerativeAI\s*\(/, provider: "google", framework: "langchain" },
  { regex: /new\s+ChatXAI\s*\(/, provider: "xai", framework: "langchain" },
];

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.git/**",
  "**/*.test.ts",
  "**/*.test.js",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.js",
  "**/__tests__/**",
  "**/*.d.ts",
];

function extractString(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function inferProviderFromModel(modelId: string): Provider | null {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"))
    return "openai";
  if (id.startsWith("gemini")) return "google";
  if (id.startsWith("grok")) return "xai";
  return null;
}

function getContextWindow(lines: string[], lineIndex: number, after = 20): string[] {
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length - 1, lineIndex + after);
  return lines.slice(start, end + 1);
}

function extractModelId(window: string[]): string | null {
  const joined = window.join("\n");

  // Standard: model: "model-id" or model="model-id" (TS/JS + Python kwargs)
  const standard = joined.match(/model\s*[:=]\s*["']([^"'\n]+)["']/);
  if (standard?.[1]) return standard[1];

  // Vercel AI SDK provider factory: model: anthropic("claude-sonnet-4") or openai("gpt-4o")
  const vercelFactory = joined.match(/model\s*:\s*\w+\(\s*["']([^"'\n]+)["']/);
  if (vercelFactory?.[1]) return vercelFactory[1];

  return null;
}

function extractPrompts(window: string[]): {
  systemPrompt: string | null;
  userPrompt: string | null;
} {
  // System prompt: system: "..." (short inline strings only)
  const systemPrompt = extractString(window, /system\s*:\s*["']([^"']{1,500})["']/);

  // User/content prompt
  const userPrompt =
    extractString(window, /content\s*:\s*["']([^"']{1,500})["']/) ??
    extractString(window, /\buser\s*:\s*["']([^"']{1,500})["']/) ??
    extractString(window, /prompt\s*[:=]\s*["']([^"']{1,500})["']/);

  return { systemPrompt, userPrompt };
}

async function scanFile(filePath: string, relativeBase: string): Promise<ScanResult[]> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const results: ScanResult[] = [];
  const relativePath = path.relative(relativeBase, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    for (const pattern of PATTERNS) {
      if (!pattern.regex.test(line)) continue;

      const window = getContextWindow(lines, i);

      const modelId = extractModelId(window);

      let provider = pattern.provider;
      if (!provider && modelId) {
        provider = inferProviderFromModel(modelId);
      }

      // Skip if we can't determine provider — not a recognizable LLM call
      if (!provider) continue;

      const { systemPrompt, userPrompt } = extractPrompts(window);

      // A result is dynamic if the model is unresolved or no static prompts found
      const isDynamic = !modelId || (!systemPrompt && !userPrompt);

      results.push({
        filePath: relativePath,
        lineNumber: i + 1,
        provider,
        model: modelId,
        systemPrompt,
        userPrompt,
        isDynamic,
        framework: pattern.framework,
      });

      break; // Only match the first pattern per line
    }
  }

  return results;
}

export async function scanDirectory(dirPath: string, ignore: string[] = []): Promise<ScanResult[]> {
  const absoluteDir = path.resolve(dirPath);
  const patterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*.${ext}`);

  const files = await glob(patterns, {
    cwd: absoluteDir,
    ignore: [...IGNORE_PATTERNS, ...ignore],
    absolute: true,
  });

  const allResults: ScanResult[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        const results = await scanFile(file, absoluteDir);
        allResults.push(...results);
      } catch {
        // Skip unreadable files silently
      }
    }),
  );

  allResults.sort((a, b) => {
    const fileCompare = a.filePath.localeCompare(b.filePath);
    return fileCompare !== 0 ? fileCompare : a.lineNumber - b.lineNumber;
  });

  return allResults;
}
