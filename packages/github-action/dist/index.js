// src/index.ts
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { calculateCost, getModel, getProviderModels } from "@inferwise/pricing-db";
import { scanDirectory } from "inferwise/sdk";
import { simpleGit } from "simple-git";
var SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"]);
var PR_COMMENT_MARKER = "<!-- inferwise-cost-diff -->";
function fallbackModel(provider) {
  const models = getProviderModels(provider).filter((m) => m.status === "current");
  if (models.length === 0) return void 0;
  models.sort((a, b) => a.input_cost_per_million - b.input_cost_per_million);
  return models[0];
}
async function checkoutRefToDir(gitRoot, ref) {
  const git = simpleGit(gitRoot);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "inferwise-action-"));
  const lsResult = await git.raw(["ls-tree", "-r", "--name-only", ref]);
  const files = lsResult.trim().split("\n").filter((f) => {
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
      }
    })
  );
  return tmpDir;
}
function typicalInputTokens(pricing) {
  return pricing.context_window < 16384 ? Math.min(4096, Math.round(pricing.context_window * 0.25)) : 4096;
}
function typicalOutputTokens(pricing) {
  return Math.max(512, Math.min(4096, Math.round(pricing.max_output_tokens * 0.05)));
}
function computeFileCosts(results, volume) {
  const byFile = /* @__PURE__ */ new Map();
  for (const r of results) {
    const directMatch = r.model ? getModel(r.provider, r.model) : void 0;
    const pricing = directMatch ?? fallbackModel(r.provider);
    const inputTokens = pricing ? typicalInputTokens(pricing) : 0;
    const outputTokens = r.maxOutputTokens ?? (pricing ? typicalOutputTokens(pricing) : 0);
    const costPerCall = pricing ? calculateCost({ model: pricing, inputTokens, outputTokens }) : 0;
    const modelLabel = r.model ?? (pricing ? `${pricing.id} (inferred)` : "unknown");
    const existing = byFile.get(r.filePath) ?? [];
    existing.push({ model: modelLabel, monthlyCost: costPerCall * volume * 30 });
    byFile.set(r.filePath, existing);
  }
  return byFile;
}
function buildMarkdownReport(baseCosts, headCosts, volume, baseRef, headRef) {
  const allFiles = /* @__PURE__ */ new Set([...baseCosts.keys(), ...headCosts.keys()]);
  const rows = [];
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
      netDelta: 0
    };
  }
  const fmt = (usd) => {
    const abs = Math.abs(usd);
    const s = abs < 1 ? `$${abs.toFixed(4)}` : abs < 100 ? `$${abs.toFixed(2)}` : `$${Math.round(abs).toLocaleString()}`;
    return `${usd >= 0 ? "+" : "-"}${s}/mo`;
  };
  const lines = [
    "## Inferwise Cost Report",
    "",
    "| File | Model | Change | Monthly Impact |",
    "|------|-------|--------|----------------|",
    ...rows.map((r) => {
      const model = r.baseModel === r.headModel ? r.headModel : r.baseModel === "(none)" ? `(new) ${r.headModel}` : r.headModel === "(none)" ? `(removed) ${r.baseModel}` : `${r.baseModel} \u2192 ${r.headModel}`;
      const change = r.baseModel === "(none)" ? "Added" : r.headModel === "(none)" ? "Removed" : "Modified";
      return `| \`${r.file}\` | ${model} | ${change} | ${fmt(r.delta)} |`;
    }),
    "",
    `**Net monthly impact: ${fmt(netDelta)}**`,
    "",
    `> Estimates based on ${volume.toLocaleString()} requests/day. Comparing \`${baseRef}\` \u2192 \`${headRef}\`.`,
    "> Configure with `inferwise.config.json`.",
    "> Powered by [Inferwise](https://inferwise.dev)"
  ];
  return { report: lines.join("\n"), netDelta };
}
async function postComment(octokit, owner, repo, issueNumber, body) {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber
  });
  const existing = comments.find((c) => c.body?.includes(PR_COMMENT_MARKER));
  const fullBody = `${PR_COMMENT_MARKER}
${body}`;
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: fullBody
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: fullBody
    });
  }
}
function validateActionConfig(raw) {
  const config = {};
  if (typeof raw.defaultVolume === "number" && raw.defaultVolume > 0) {
    config.defaultVolume = raw.defaultVolume;
  }
  if (raw.budgets && typeof raw.budgets === "object" && !Array.isArray(raw.budgets)) {
    const b = raw.budgets;
    const budgets = {};
    if (typeof b.warn === "number" && b.warn >= 0) budgets.warn = b.warn;
    if (typeof b.block === "number" && b.block >= 0) budgets.block = b.block;
    if (typeof b.requireApproval === "number" && b.requireApproval >= 0)
      budgets.requireApproval = b.requireApproval;
    if (Array.isArray(b.approvers))
      budgets.approvers = b.approvers.filter((a) => typeof a === "string");
    if (budgets.warn !== void 0 && budgets.block !== void 0 && budgets.warn >= budgets.block) {
      core.warning(
        "inferwise.config.json: budgets.warn must be less than budgets.block \u2014 ignoring budgets"
      );
    } else if (budgets.warn !== void 0 && budgets.requireApproval !== void 0 && budgets.warn >= budgets.requireApproval) {
      core.warning(
        "inferwise.config.json: budgets.warn must be less than budgets.requireApproval \u2014 ignoring budgets"
      );
    } else if (budgets.requireApproval !== void 0 && budgets.block !== void 0 && budgets.requireApproval >= budgets.block) {
      core.warning(
        "inferwise.config.json: budgets.requireApproval must be less than budgets.block \u2014 ignoring budgets"
      );
    } else {
      config.budgets = budgets;
    }
  }
  return config;
}
async function loadActionConfig(dir) {
  const { readFile } = await import("fs/promises");
  try {
    const raw = await readFile(path.join(dir, "inferwise.config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return validateActionConfig(parsed);
  } catch {
    return {};
  }
}
async function ensureLabel(octokit, owner, repo, prNumber, label, color, description) {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: label });
  } catch {
    await octokit.rest.issues.createLabel({ owner, repo, name: label, color, description }).catch(() => {
    });
  }
  await octokit.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [label] }).catch(() => {
  });
}
async function run() {
  const token = core.getInput("github-token", { required: true });
  const volumeStr = core.getInput("volume") || "1000";
  const volume = Math.max(1, Number.parseInt(volumeStr, 10) || 1e3);
  const failOnIncreaseStr = core.getInput("fail-on-increase");
  const workingDir = core.getInput("working-directory") || ".";
  const ctx = github.context;
  const prNumber = ctx.payload.pull_request?.number;
  const baseRef = core.getInput("base-ref") || ctx.payload.pull_request?.base?.ref || "main";
  const headSha = ctx.payload.pull_request?.head?.sha ?? "HEAD";
  const gitRoot = path.resolve(workingDir);
  let baseDir = null;
  try {
    const config = await loadActionConfig(gitRoot);
    const budgets = config.budgets;
    const configVolume = config.defaultVolume;
    const effectiveVolume = volumeStr !== "1000" ? volume : configVolume ?? volume;
    core.info(`Comparing ${baseRef} \u2192 ${headSha}`);
    baseDir = await checkoutRefToDir(gitRoot, `origin/${baseRef}`);
    const [baseResults, headResults] = await Promise.all([
      scanDirectory(baseDir),
      scanDirectory(gitRoot)
    ]);
    const baseCosts = computeFileCosts(baseResults, effectiveVolume);
    const headCosts = computeFileCosts(headResults, effectiveVolume);
    const { report, netDelta } = buildMarkdownReport(
      baseCosts,
      headCosts,
      effectiveVolume,
      baseRef,
      headSha
    );
    core.setOutput("net-monthly-delta", String(netDelta.toFixed(2)));
    core.setOutput("report", report);
    core.info(report);
    if (prNumber) {
      const octokit = github.getOctokit(token);
      await postComment(octokit, ctx.repo.owner, ctx.repo.repo, prNumber, report);
      core.info("Posted cost diff comment to PR.");
      if (budgets && netDelta > 0) {
        if (budgets.warn !== void 0 && netDelta >= budgets.warn) {
          await ensureLabel(
            octokit,
            ctx.repo.owner,
            ctx.repo.repo,
            prNumber,
            "cost-warning",
            "fbca04",
            `Inferwise: cost increase exceeds $${budgets.warn}/mo warn threshold`
          );
          core.warning(
            `Cost increase $${netDelta.toFixed(2)}/mo exceeds warn threshold $${budgets.warn}/mo.`
          );
        }
        if (budgets.requireApproval !== void 0 && netDelta >= budgets.requireApproval) {
          await ensureLabel(
            octokit,
            ctx.repo.owner,
            ctx.repo.repo,
            prNumber,
            "cost-approval-required",
            "d93f0b",
            `Inferwise: cost increase exceeds $${budgets.requireApproval}/mo \u2014 requires approval`
          );
          if (budgets.approvers && budgets.approvers.length > 0) {
            const reviewers = budgets.approvers.filter((a) => a.startsWith("@")).map((a) => a.replace(/^@/, ""));
            const teamReviewers = budgets.approvers.filter((a) => !a.startsWith("@"));
            await octokit.rest.pulls.requestReviewers({
              owner: ctx.repo.owner,
              repo: ctx.repo.repo,
              pull_number: prNumber,
              ...reviewers.length > 0 ? { reviewers } : {},
              ...teamReviewers.length > 0 ? { team_reviewers: teamReviewers } : {}
            }).catch((err) => {
              core.warning(
                `Could not request reviewers: ${err instanceof Error ? err.message : String(err)}`
              );
            });
          }
        }
        if (budgets.block !== void 0 && netDelta >= budgets.block) {
          await ensureLabel(
            octokit,
            ctx.repo.owner,
            ctx.repo.repo,
            prNumber,
            "cost-blocked",
            "e11d48",
            `Inferwise: cost increase exceeds $${budgets.block}/mo block threshold`
          );
          core.setFailed(
            `Monthly cost increase $${netDelta.toFixed(2)} exceeds budget block threshold $${budgets.block.toFixed(2)}/mo.`
          );
          return;
        }
      }
    }
    if (failOnIncreaseStr) {
      const threshold = Number.parseFloat(failOnIncreaseStr);
      if (!Number.isNaN(threshold) && netDelta > threshold) {
        core.setFailed(
          `Monthly cost increase $${netDelta.toFixed(2)} exceeds threshold $${threshold.toFixed(2)}.`
        );
      }
    }
  } finally {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true }).catch(() => {
      });
    }
  }
}
run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
export {
  buildMarkdownReport,
  computeFileCosts
};
