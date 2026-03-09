import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import type { ModelPricing, Provider } from "@inferwise/pricing-db";
import { simpleGit } from "simple-git";

const SUPPORTED_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"]);
const PR_COMMENT_MARKER = "<!-- inferwise-cost-diff -->";

interface ScanResult {
  filePath: string;
  lineNumber: number;
  provider: Provider;
  model: string | null;
  systemPrompt: string | null;
  userPrompt: string | null;
  maxOutputTokens: number | null;
  isDynamic: boolean;
}

/** When model is unknown, use the cheapest current model for the provider as a floor. */
function fallbackModel(provider: Provider): ModelPricing | undefined {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return undefined;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}

function extractMaxOutputTokens(window: string[]): number | null {
  const joined = window.join("\n");
  const match = joined.match(
    /(?:max_tokens|maxTokens|max_output_tokens|maxOutputTokens)\s*[:=]\s*(\d+)/,
  );
  if (match?.[1]) {
    const value = Number.parseInt(match[1], 10);
    if (value > 0) return value;
  }
  return null;
}

interface FileCostEntry {
  model: string;
  monthlyCost: number;
}

async function checkoutRefToDir(gitRoot: string, ref: string): Promise<string> {
  const git = simpleGit(gitRoot);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "inferwise-action-"));

  const lsResult = await git.raw(["ls-tree", "-r", "--name-only", ref]);
  const files = lsResult
    .trim()
    .split("\n")
    .filter((f) => {
      if (!f) return false;
      const ext = f.split(".").pop() ?? "";
      return SUPPORTED_EXTENSIONS.has(ext);
    });

  await Promise.all(
    files.map(async (file) => {
      try {
        const content = await git.show([`${ref}:${file}`]);
        const destPath = path.join(tmpDir, file);
        await mkdir(path.dirname(destPath), { recursive: true });
        await writeFile(destPath, content, "utf-8");
      } catch {
        // File may not exist at this ref
      }
    }),
  );

  return tmpDir;
}

function inferProvider(modelId: string): Provider | null {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"))
    return "openai";
  if (id.startsWith("gemini")) return "google";
  if (id.startsWith("grok")) return "xai";
  return null;
}

async function scanDir(dirPath: string): Promise<ScanResult[]> {
  // Dynamic import to avoid bundling issues — the CLI scanner handles file scanning
  const { scanDirectory } = await import(
    path.join(dirPath, "node_modules", "inferwise", "dist", "index.js")
  ).catch(() => ({ scanDirectory: null }));

  if (!scanDirectory) {
    // Fallback: inline minimal scanner
    return inlineScan(dirPath);
  }

  return scanDirectory(dirPath) as Promise<ScanResult[]>;
}

const PATTERNS = [
  { regex: /\.messages\.create\s*\(/, provider: "anthropic" as Provider },
  { regex: /\.chat\.completions\.create\s*\(/, provider: "openai" as Provider },
  { regex: /\.generateContent\s*\(/, provider: "google" as Provider },
  { regex: /\bgenerateText\s*\(/, provider: null },
  { regex: /\bstreamText\s*\(/, provider: null },
  { regex: /new\s+ChatAnthropic\s*\(/, provider: "anthropic" as Provider },
  { regex: /new\s+ChatOpenAI\s*\(/, provider: "openai" as Provider },
];

const IGNORE = new Set([".git", "node_modules", "dist", "build", "out"]);

async function inlineScan(dirPath: string): Promise<ScanResult[]> {
  const { readdir, readFile, stat } = await import("node:fs/promises");
  const results: ScanResult[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      entries.map(async (entry) => {
        if (IGNORE.has(entry)) return;
        const full = path.join(dir, entry);
        const s = await stat(full).catch(() => null);
        if (!s) return;
        if (s.isDirectory()) {
          await walk(full);
          return;
        }
        const ext = entry.split(".").pop() ?? "";
        if (!SUPPORTED_EXTENSIONS.has(ext)) return;
        if (entry.endsWith(".test.ts") || entry.endsWith(".spec.ts")) return;

        const content = await readFile(full, "utf-8").catch(() => "");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          for (const pat of PATTERNS) {
            if (!pat.regex.test(line)) continue;

            const window = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 20));
            const joined = window.join("\n");

            const modelMatch =
              joined.match(/model\s*[:=]\s*["']([^"'\n]+)["']/) ??
              joined.match(/model\s*:\s*\w+\(\s*["']([^"'\n]+)["']/);
            const modelId = modelMatch?.[1] ?? null;

            let provider = pat.provider;
            if (!provider && modelId) {
              provider = inferProvider(modelId);
            }
            if (!provider) continue;

            const maxOutputTokens = extractMaxOutputTokens(window);

            results.push({
              filePath: path.relative(dirPath, full),
              lineNumber: i + 1,
              provider,
              model: modelId,
              systemPrompt: null,
              userPrompt: null,
              maxOutputTokens,
              isDynamic: !modelId,
            });
            break;
          }
        }
      }),
    );
  }

  await walk(dirPath);
  results.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber);
  return results;
}

function computeFileCosts(results: ScanResult[], volume: number): Map<string, FileCostEntry[]> {
  const byFile = new Map<string, FileCostEntry[]>();

  for (const r of results) {
    // Resolve model — exact match or cheapest current model for the provider
    const pricing = r.model ? getModel(r.provider, r.model) : fallbackModel(r.provider);

    // Input tokens: context_window - max_output_tokens (worst-case ceiling from model spec)
    const inputTokens = pricing ? pricing.context_window - pricing.max_output_tokens : 0;

    // Output tokens: max_tokens from code, or model's max_output_tokens as ceiling
    const outputTokens = r.maxOutputTokens ?? (pricing ? pricing.max_output_tokens : 0);

    const costPerCall = pricing ? calculateCost({ model: pricing, inputTokens, outputTokens }) : 0;
    const modelLabel = r.model ?? (pricing ? `${pricing.id} (inferred)` : "unknown");

    const existing = byFile.get(r.filePath) ?? [];
    existing.push({ model: modelLabel, monthlyCost: costPerCall * volume * 30 });
    byFile.set(r.filePath, existing);
  }

  return byFile;
}

function buildMarkdownReport(
  baseCosts: Map<string, FileCostEntry[]>,
  headCosts: Map<string, FileCostEntry[]>,
  volume: number,
  baseRef: string,
  headRef: string,
): { report: string; netDelta: number } {
  const allFiles = new Set([...baseCosts.keys(), ...headCosts.keys()]);
  const rows: Array<{ file: string; baseModel: string; headModel: string; delta: number }> = [];

  for (const file of allFiles) {
    const base = baseCosts.get(file) ?? [];
    const head = headCosts.get(file) ?? [];
    const baseCost = base.reduce((s, e) => s + e.monthlyCost, 0);
    const headCost = head.reduce((s, e) => s + e.monthlyCost, 0);
    const delta = headCost - baseCost;
    if (delta === 0) continue;

    const baseModel = base[0]?.model ?? "(none)";
    const headModel = head[0]?.model ?? "(none)";
    rows.push({ file, baseModel, headModel, delta });
  }

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const netDelta = rows.reduce((s, r) => s + r.delta, 0);

  if (rows.length === 0) {
    return {
      report: "No cost changes detected between refs.",
      netDelta: 0,
    };
  }

  const fmt = (usd: number): string => {
    const abs = Math.abs(usd);
    const s =
      abs < 1
        ? `$${abs.toFixed(4)}`
        : abs < 100
          ? `$${abs.toFixed(2)}`
          : `$${Math.round(abs).toLocaleString()}`;
    return `${usd >= 0 ? "+" : "-"}${s}/mo`;
  };

  const lines = [
    "## Inferwise Cost Report",
    "",
    "| File | Model | Change | Monthly Impact |",
    "|------|-------|--------|----------------|",
    ...rows.map((r) => {
      const model =
        r.baseModel === r.headModel
          ? r.headModel
          : r.baseModel === "(none)"
            ? `(new) ${r.headModel}`
            : r.headModel === "(none)"
              ? `(removed) ${r.baseModel}`
              : `${r.baseModel} → ${r.headModel}`;
      const change =
        r.baseModel === "(none)" ? "Added" : r.headModel === "(none)" ? "Removed" : "Modified";
      return `| \`${r.file}\` | ${model} | ${change} | ${fmt(r.delta)} |`;
    }),
    "",
    `**Net monthly impact: ${fmt(netDelta)}**`,
    "",
    `> Estimates based on ${volume.toLocaleString()} requests/day. Comparing \`${baseRef}\` → \`${headRef}\`.`,
    "> Configure with `inferwise.config.json`.",
    "> Powered by [Inferwise](https://inferwise.dev)",
  ];

  return { report: lines.join("\n"), netDelta };
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const existing = comments.find((c) => c.body?.includes(PR_COMMENT_MARKER));
  const fullBody = `${PR_COMMENT_MARKER}\n${body}`;

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: fullBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: fullBody,
    });
  }
}

async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const volumeStr = core.getInput("volume") || "1000";
  const volume = Math.max(1, Number.parseInt(volumeStr, 10) || 1000);
  const failOnIncreaseStr = core.getInput("fail-on-increase");
  const workingDir = core.getInput("working-directory") || ".";

  const ctx = github.context;
  const prNumber = ctx.payload.pull_request?.number;
  const baseRef = core.getInput("base-ref") || ctx.payload.pull_request?.base?.ref || "main";
  const headSha = ctx.payload.pull_request?.head?.sha ?? "HEAD";

  const gitRoot = path.resolve(workingDir);
  let baseDir: string | null = null;

  try {
    core.info(`Comparing ${baseRef} → ${headSha}`);

    baseDir = await checkoutRefToDir(gitRoot, `origin/${baseRef}`);

    const [baseResults, headResults] = await Promise.all([
      inlineScan(baseDir),
      inlineScan(gitRoot),
    ]);

    const baseCosts = computeFileCosts(baseResults, volume);
    const headCosts = computeFileCosts(headResults, volume);

    const { report, netDelta } = buildMarkdownReport(
      baseCosts,
      headCosts,
      volume,
      baseRef,
      headSha,
    );

    core.setOutput("net-monthly-delta", String(netDelta.toFixed(2)));
    core.setOutput("report", report);
    core.info(report);

    if (prNumber) {
      const octokit = github.getOctokit(token);
      await postComment(octokit, ctx.repo.owner, ctx.repo.repo, prNumber, report);
      core.info("Posted cost diff comment to PR.");
    }

    if (failOnIncreaseStr) {
      const threshold = Number.parseFloat(failOnIncreaseStr);
      if (!Number.isNaN(threshold) && netDelta > threshold) {
        core.setFailed(
          `Monthly cost increase $${netDelta.toFixed(2)} exceeds threshold $${threshold.toFixed(2)}.`,
        );
      }
    }
  } finally {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
