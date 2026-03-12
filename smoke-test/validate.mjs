#!/usr/bin/env node
/**
 * Validates `inferwise estimate smoke-test/ --format json` output.
 *
 * Assertions:
 *   - Exactly 3 call sites detected
 *   - Correct providers and models
 *   - All costs > 0
 *   - Sonnet call does NOT bleed the OpenAI user prompt
 *
 * Usage:
 *   node packages/cli/dist/index.js estimate smoke-test/ --format json | node smoke-test/validate.mjs
 */

// Read all of stdin (cross-platform — /dev/stdin doesn't exist on Windows)
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const raw = Buffer.concat(chunks).toString("utf-8");
const data = JSON.parse(raw);

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`OK:   ${message}`);
  }
}

const sites = data.callSites;

assert(Array.isArray(sites), "callSites is an array");
assert(sites.length === 3, `expected 3 call sites, got ${sites?.length}`);

// --- Call site 1: Opus classification ---
const opus = sites.find((s) => s.model?.includes("opus"));
assert(opus, "found Opus call site");
assert(opus?.provider === "anthropic", `Opus provider is anthropic (got ${opus?.provider})`);
assert(opus?.costPerCall > 0, `Opus costPerCall > 0 (got ${opus?.costPerCall})`);

// --- Call site 2: Sonnet code generation ---
const sonnet = sites.find((s) => s.model?.includes("sonnet"));
assert(sonnet, "found Sonnet call site");
assert(sonnet?.provider === "anthropic", `Sonnet provider is anthropic (got ${sonnet?.provider})`);
assert(sonnet?.costPerCall > 0, `Sonnet costPerCall > 0 (got ${sonnet?.costPerCall})`);
// Sonnet should NOT have the OpenAI call's user prompt
assert(!sonnet?.userPrompt, `Sonnet userPrompt should be null (got "${sonnet?.userPrompt}")`);

// --- Call site 3: GPT-4o summarization ---
const gpt = sites.find((s) => s.model?.includes("gpt-4o"));
assert(gpt, "found GPT-4o call site");
assert(gpt?.provider === "openai", `GPT-4o provider is openai (got ${gpt?.provider})`);
assert(gpt?.costPerCall > 0, `GPT-4o costPerCall > 0 (got ${gpt?.costPerCall})`);

// --- Monthly totals ---
assert(data.totalMonthlyCost > 0, `totalMonthlyCost > 0 (got ${data.totalMonthlyCost})`);

console.log(`\n${failures === 0 ? "All smoke tests passed." : `${failures} smoke test(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
