# Databricks notebook source

# MAGIC %md
# MAGIC # NVIDIA Inference Hub — End-to-End Demo
# MAGIC
# MAGIC **What this notebook demonstrates:**
# MAGIC 1. Connecting to the NVIDIA Inference Hub (OpenAI-compatible API)
# MAGIC 2. Comparing models side-by-side (latency, tokens, quality)
# MAGIC 3. Realistic production patterns (system prompts, streaming)
# MAGIC 4. Cost analysis with Inferwise (estimate, audit, model swap recommendations)
# MAGIC 5. Auto-fix — automatically rewrite expensive model IDs in source code
# MAGIC 6. Budget gate — enforce spend thresholds in CI/CD pipelines
# MAGIC
# MAGIC **Prerequisites:**
# MAGIC - `NVIDIA_API_KEY` set in Databricks secret scope (`nvidia/api_key`) or as a cluster env var
# MAGIC - Cluster with internet access and Python 3.10+

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Setup & Connectivity

# COMMAND ----------

# MAGIC %pip install openai>=1.40.0 typing_extensions>=4.5.0 --upgrade --quiet

# COMMAND ----------

dbutils.library.restartPython()  # noqa: F821

# COMMAND ----------

import os
import json
import time
from openai import OpenAI
import pandas as pd

# --- Auth: paste your key here (or set NVIDIA_API_KEY env var) ---
NVIDIA_API_KEY = ""  # <-- paste your nvapi-... key here

api_key = NVIDIA_API_KEY or os.environ.get("NVIDIA_API_KEY", "")
assert api_key, "Paste your NVIDIA_API_KEY above or set it as an env var"

client = OpenAI(
    base_url="https://inference-api.nvidia.com/v1",
    api_key=api_key,
)

# Quick health check
response = client.chat.completions.create(
    model="openai/openai/gpt-5.4",
    messages=[{"role": "user", "content": "Respond with exactly: NVIDIA Inference Hub is live."}],
    max_tokens=20,
    temperature=0,
)
print(f"Health check: {response.choices[0].message.content}")
print(f"Model: {response.model} | Tokens: {response.usage.prompt_tokens} in / {response.usage.completion_tokens} out")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Model Comparison Matrix
# MAGIC
# MAGIC Same prompt across multiple models — compare latency, token usage, and response quality.

# COMMAND ----------

MODELS = [
    "aws/anthropic/bedrock-claude-opus-4-7",
    "aws/anthropic/bedrock-claude-sonnet-4-6",
    "openai/openai/gpt-5.4",
    "gcp/google/gemini-3-pro",
]

TEST_PROMPT = "Explain Kubernetes pod scheduling in exactly 3 sentences."

results = []
for model in MODELS:
    start = time.time()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": TEST_PROMPT}],
            max_tokens=256,
            temperature=0,
        )
        elapsed = time.time() - start
        results.append({
            "Model": model.split("/")[-1],
            "Full Model ID": model,
            "Latency (s)": round(elapsed, 2),
            "Input Tokens": resp.usage.prompt_tokens,
            "Output Tokens": resp.usage.completion_tokens,
            "Response": resp.choices[0].message.content[:200],
        })
    except Exception as e:
        results.append({
            "Model": model.split("/")[-1],
            "Full Model ID": model,
            "Latency (s)": None,
            "Input Tokens": None,
            "Output Tokens": None,
            "Response": f"ERROR: {e}",
        })

df_comparison = pd.DataFrame(results)
display(df_comparison[["Model", "Latency (s)", "Input Tokens", "Output Tokens"]])

# COMMAND ----------

# Show full responses for qualitative comparison
for _, row in df_comparison.iterrows():
    print(f"\n{'='*60}")
    print(f"Model: {row['Model']}")
    print(f"{'='*60}")
    print(row["Response"])

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Realistic Production Pattern
# MAGIC
# MAGIC System prompt + user prompt with structured output — simulates a real application call.

# COMMAND ----------

SYSTEM_PROMPT = """You are an IT cost analyst assistant for a large enterprise.
Given a cloud infrastructure description, estimate the monthly cost breakdown.
Respond in JSON format with keys: service, estimated_monthly_cost, confidence."""

USER_PROMPT = """We're running:
- 3x p4d.24xlarge GPU instances on AWS (24/7)
- 50TB S3 storage with 1M GET requests/day
- 2x NAT gateways in us-east-1
- CloudFront CDN serving 10TB/month"""

# --- Non-streaming call ---
start = time.time()
response = client.chat.completions.create(
    model="openai/openai/gpt-5.4",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_PROMPT},
    ],
    max_tokens=1024,
    temperature=0,
)
latency_non_stream = time.time() - start

print(f"Non-streaming latency: {latency_non_stream:.2f}s")
print(f"Tokens: {response.usage.prompt_tokens} in / {response.usage.completion_tokens} out")
print(f"\nResponse:\n{response.choices[0].message.content}")

# COMMAND ----------

# --- Streaming call (same prompt) ---
start = time.time()
first_token_time = None
full_response = ""

stream = client.chat.completions.create(
    model="openai/openai/gpt-5.4",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_PROMPT},
    ],
    max_tokens=1024,
    temperature=0,
    stream=True,
)

for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        if first_token_time is None:
            first_token_time = time.time() - start
        full_response += chunk.choices[0].delta.content

total_stream_time = time.time() - start

print(f"Streaming: TTFT={first_token_time:.2f}s | Total={total_stream_time:.2f}s")
print(f"Non-streaming: {latency_non_stream:.2f}s")
print(f"\nStreaming is {latency_non_stream / (first_token_time or 1):.1f}x faster to first token")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Inferwise Cost Analysis
# MAGIC
# MAGIC Write the API call code to a file, then run Inferwise to estimate costs and find cheaper alternatives.

# COMMAND ----------

# --- Pricing data (from Inferwise pricing-db) ---
MODEL_PRICING = {
    "bedrock-claude-opus-4-7": {
        "input_cost_per_million": 15.00,
        "output_cost_per_million": 75.00,
        "tier": "premium",
    },
    "bedrock-claude-sonnet-4-6": {
        "input_cost_per_million": 3.00,
        "output_cost_per_million": 15.00,
        "tier": "mid",
    },
    "gpt-5.4": {
        "input_cost_per_million": 2.50,
        "output_cost_per_million": 10.00,
        "tier": "mid",
    },
    "gemini-3-pro": {
        "input_cost_per_million": 1.25,
        "output_cost_per_million": 5.00,
        "tier": "budget",
    },
}

DAILY_VOLUME = 1000  # requests per day

# --- Cost estimate using real token counts from our API calls ---
print("=" * 76)
print("INFERWISE COST ESTIMATE")
print("=" * 76)
print(f"{'Model':<28} {'In Tok':>8} {'Out Tok':>8} {'Cost/Call':>10} {'Monthly':>12}")
print("-" * 76)

estimate_rows = []
for _, row in df_comparison.iterrows():
    model = row["Model"]
    full_id = row["Full Model ID"]
    # Strip provider prefix for pricing lookup (handles aws/anthropic/, openai/openai/, google/google/)
    bare_model = model.split("/")[-1]
    pricing = MODEL_PRICING.get(bare_model)
    if not pricing or row["Input Tokens"] is None:
        continue

    in_tok = row["Input Tokens"]
    out_tok = row["Output Tokens"]
    cost_per_call = (in_tok * pricing["input_cost_per_million"] + out_tok * pricing["output_cost_per_million"]) / 1_000_000
    monthly = cost_per_call * DAILY_VOLUME * 30

    print(f"{bare_model:<28} {in_tok:>8} {out_tok:>8} ${cost_per_call:>8.4f} ${monthly:>10,.2f}/mo")
    estimate_rows.append({
        "Model": bare_model,
        "Input Tokens": in_tok,
        "Output Tokens": out_tok,
        "Cost/Call": cost_per_call,
        "Monthly Cost": monthly,
        "Tier": pricing["tier"],
    })

# Also estimate the Section 3 production call
prod_in = response.usage.prompt_tokens
prod_out = response.usage.completion_tokens
prod_pricing = MODEL_PRICING["gpt-5.4"]
prod_cost = (prod_in * prod_pricing["input_cost_per_million"] + prod_out * prod_pricing["output_cost_per_million"]) / 1_000_000
prod_monthly = prod_cost * DAILY_VOLUME * 30
print(f"{'gpt-5.4 (prod)':<28} {prod_in:>8} {prod_out:>8} ${prod_cost:>8.4f} ${prod_monthly:>10,.2f}/mo")

print("-" * 76)
total_monthly = sum(r["Monthly Cost"] for r in estimate_rows) + prod_monthly
print(f"{'TOTAL':<28} {'':>8} {'':>8} {'':>10} ${total_monthly:>10,.2f}/mo")
print(f"\nBased on {DAILY_VOLUME:,} requests/day per call site.")

df_estimates = pd.DataFrame(estimate_rows)

# COMMAND ----------

# MAGIC %md
# MAGIC ### Cost Optimization Audit
# MAGIC
# MAGIC For each model, check if a cheaper alternative exists with the same capabilities.

# COMMAND ----------

print("=" * 76)
print("INFERWISE COST AUDIT — Model Swap Recommendations")
print("=" * 76)

for row in estimate_rows:
    model = row["Model"]
    tier = row["Tier"]
    monthly = row["Monthly Cost"]

    if tier == "premium":
        alt = "gemini-3-pro"
        alt_pricing = MODEL_PRICING[alt]
        alt_cost = (row["Input Tokens"] * alt_pricing["input_cost_per_million"] + row["Output Tokens"] * alt_pricing["output_cost_per_million"]) / 1_000_000
        alt_monthly = alt_cost * DAILY_VOLUME * 30
        savings = monthly - alt_monthly
        pct = (savings / monthly) * 100

        print(f"\n  {model} → {alt}")
        print(f"    Current:  ${monthly:>10,.2f}/mo")
        print(f"    With swap: ${alt_monthly:>10,.2f}/mo")
        print(f"    Savings:  ${savings:>10,.2f}/mo ({pct:.0f}%)")
        print(f"    Reason:   Opus is premium-tier. Gemini 3 Pro handles general tasks")
        print(f"              at 90%+ lower cost. Use Opus only for tasks requiring")
        print(f"              maximum reasoning depth.")

    elif tier == "mid":
        alt = "gemini-3-pro"
        alt_pricing = MODEL_PRICING[alt]
        alt_cost = (row["Input Tokens"] * alt_pricing["input_cost_per_million"] + row["Output Tokens"] * alt_pricing["output_cost_per_million"]) / 1_000_000
        alt_monthly = alt_cost * DAILY_VOLUME * 30
        savings = monthly - alt_monthly
        pct = (savings / monthly) * 100

        print(f"\n  {model} → {alt} (if task is simple)")
        print(f"    Current:  ${monthly:>10,.2f}/mo")
        print(f"    With swap: ${alt_monthly:>10,.2f}/mo")
        print(f"    Savings:  ${savings:>10,.2f}/mo ({pct:.0f}%)")
        print(f"    Reason:   For simple summarization/extraction tasks, Gemini 3 Pro")
        print(f"              is the most cost-efficient option on the Hub.")

    else:
        print(f"\n  {model} — already on the most cost-efficient tier.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Auto-Fix — Rewrite Expensive Models in Code
# MAGIC
# MAGIC `inferwise fix` scans source files, finds expensive model IDs, and rewrites them in-place.
# MAGIC Here we simulate that on a sample code snippet — same logic the CLI uses.

# COMMAND ----------

# --- Sample production code that uses an expensive model ---
SAMPLE_CODE = '''\
from openai import OpenAI

client = OpenAI(base_url="https://inference-api.nvidia.com/v1", api_key=API_KEY)

# Chat endpoint — uses premium-tier model
response = client.chat.completions.create(
    model="aws/anthropic/bedrock-claude-opus-4-7",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": user_query},
    ],
    max_tokens=1024,
)

# Summarization endpoint — uses mid-tier model
summary = client.chat.completions.create(
    model="aws/anthropic/bedrock-claude-sonnet-4-6",
    messages=[{"role": "user", "content": f"Summarize: {document}"}],
    max_tokens=512,
)
'''

# --- Build swap recommendations from the audit ---
SWAP_RULES = {
    "bedrock-claude-opus-4-7": {
        "replacement": "gcp/google/gemini-3-pro",
        "reason": "Premium → budget tier (same capabilities for this task)",
    },
    "bedrock-claude-sonnet-4-6": {
        "replacement": "gcp/google/gemini-3-pro",
        "reason": "Mid → budget tier for simple summarization",
    },
}

print("=" * 76)
print("INFERWISE FIX — Auto-Swap Preview")
print("=" * 76)

print("\n BEFORE (original code):")
print("-" * 76)
for i, line in enumerate(SAMPLE_CODE.strip().split("\n"), 1):
    marker = "  <<<" if "model=" in line else ""
    print(f"  {i:>2} | {line}{marker}")

# Apply swaps
fixed_code = SAMPLE_CODE
swaps_applied = []
for old_model, rule in SWAP_RULES.items():
    if old_model in fixed_code:
        # Preserve the provider prefix structure
        old_full = next(
            (m for m in ["aws/anthropic/" + old_model] if m in fixed_code),
            old_model
        )
        fixed_code = fixed_code.replace(old_full, rule["replacement"])
        swaps_applied.append((old_model, rule["replacement"], rule["reason"]))

print(f"\n AFTER (auto-fixed):")
print("-" * 76)
for i, line in enumerate(fixed_code.strip().split("\n"), 1):
    marker = "  <<<" if "model=" in line else ""
    print(f"  {i:>2} | {line}{marker}")

print(f"\n SWAPS APPLIED ({len(swaps_applied)}):")
print("-" * 76)
for old, new, reason in swaps_applied:
    old_pricing = MODEL_PRICING[old]
    new_pricing = MODEL_PRICING[new.split("/")[-1]]
    old_cost = (500 * old_pricing["input_cost_per_million"] + 200 * old_pricing["output_cost_per_million"]) / 1_000_000
    new_cost = (500 * new_pricing["input_cost_per_million"] + 200 * new_pricing["output_cost_per_million"]) / 1_000_000
    savings_pct = ((old_cost - new_cost) / old_cost) * 100
    print(f"  {old}")
    print(f"    → {new}")
    print(f"    Savings: {savings_pct:.0f}% per call | Reason: {reason}")

print(f"\n In production: `npx inferwise fix .` applies these swaps across your entire codebase.")
print(f" Use `npx inferwise fix --dry-run .` to preview without modifying files.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Budget Gate — CI/CD Cost Enforcement
# MAGIC
# MAGIC `inferwise check` and `inferwise diff` enforce spending thresholds in your CI pipeline.
# MAGIC If costs exceed the configured budget, the pipeline blocks the merge.

# COMMAND ----------

# --- Simulate budget policy from inferwise.config.json ---
BUDGET_CONFIG = {
    "warn": 2_000,           # Yellow flag on PRs
    "requireApproval": 10_000,  # Needs platform-eng sign-off
    "block": 50_000,         # Hard block — cannot merge
    "approvers": ["platform-eng", "@infra-team"],
}

# Use the real total monthly cost we calculated in Section 4
current_monthly = total_monthly

print("=" * 76)
print("INFERWISE BUDGET GATE — CI/CD Enforcement")
print("=" * 76)

print(f"\n  Policy (from inferwise.config.json):")
print(f"    Warn threshold:     ${BUDGET_CONFIG['warn']:>10,.2f}/mo")
print(f"    Approval required:  ${BUDGET_CONFIG['requireApproval']:>10,.2f}/mo")
print(f"    Hard block:         ${BUDGET_CONFIG['block']:>10,.2f}/mo")
print(f"    Approvers:          {', '.join(BUDGET_CONFIG['approvers'])}")

print(f"\n  Estimated monthly spend: ${current_monthly:>10,.2f}/mo")
print()

# --- Evaluate thresholds ---
if current_monthly >= BUDGET_CONFIG["block"]:
    status = "BLOCKED"
    color_label = "cost-blocked (red)"
    action = "CI check FAILS. Merge is blocked until costs are reduced."
    exit_code = 1
elif current_monthly >= BUDGET_CONFIG["requireApproval"]:
    status = "APPROVAL REQUIRED"
    color_label = "cost-approval-required (orange)"
    action = f"Review requested from: {', '.join(BUDGET_CONFIG['approvers'])}"
    exit_code = 0
elif current_monthly >= BUDGET_CONFIG["warn"]:
    status = "WARNING"
    color_label = "cost-warning (yellow)"
    action = "Warning comment posted on PR. Merge allowed."
    exit_code = 0
else:
    status = "PASS"
    color_label = "none"
    action = "No action needed. Costs are within budget."
    exit_code = 0

print(f"  ┌─────────────────────────────────────────────────────┐")
print(f"  │  Status: {status:<44}│")
print(f"  │  PR Label: {color_label:<42}│")
print(f"  │  Exit Code: {exit_code:<41}│")
print(f"  └─────────────────────────────────────────────────────┘")
print(f"\n  Action: {action}")

# --- Show what happens at different traffic volumes ---
print(f"\n  Sensitivity Analysis (same models, different traffic):")
print(f"  {'Volume':>12} {'Monthly Cost':>14} {'Status':>20}")
print(f"  {'-'*12} {'-'*14} {'-'*20}")

base_cost_per_req = current_monthly / (DAILY_VOLUME * 30)
for vol in [100, 500, 1_000, 5_000, 10_000, 50_000]:
    projected = base_cost_per_req * vol * 30
    if projected >= BUDGET_CONFIG["block"]:
        vol_status = "BLOCKED"
    elif projected >= BUDGET_CONFIG["requireApproval"]:
        vol_status = "APPROVAL REQUIRED"
    elif projected >= BUDGET_CONFIG["warn"]:
        vol_status = "WARNING"
    else:
        vol_status = "PASS"
    print(f"  {vol:>10,}/day ${projected:>12,.2f} {vol_status:>20}")

print(f"\n In production:")
print(f"   • Pre-commit hook: `npx inferwise check .` runs before every commit")
print(f"   • CI gate: `npx inferwise diff --base main` compares cost delta on PRs")
print(f"   • GitHub Action: inferwise/inferwise-action@v1 posts comments + labels + blocks")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Summary
# MAGIC
# MAGIC ### What We Demonstrated
# MAGIC
# MAGIC | Step | What | Result |
# MAGIC |------|------|--------|
# MAGIC | **Connectivity** | NVIDIA Inference Hub endpoint | OpenAI-compatible, works with standard SDKs |
# MAGIC | **Model Comparison** | Side-by-side latency & quality | Compare models on identical prompts |
# MAGIC | **Production Pattern** | System + user prompts, streaming | TTFT metrics, structured output |
# MAGIC | **Cost Analysis** | Inferwise estimate + audit | Per-call costs, monthly projections, model swap recommendations |
# MAGIC | **Auto-Fix** | Rewrite model IDs in code | One command to swap expensive models across entire codebase |
# MAGIC | **Budget Gate** | CI/CD cost enforcement | Warn, require approval, or block merges based on spend thresholds |
# MAGIC
# MAGIC ### Key Takeaways
# MAGIC
# MAGIC 1. **One endpoint, multiple models** — The NVIDIA Inference Hub provides a single OpenAI-compatible API for all models
# MAGIC 2. **Standard SDK** — No custom client needed, just point the OpenAI SDK at `inference-api.nvidia.com`
# MAGIC 3. **Cost visibility** — Inferwise catches expensive model choices at code review time, before they hit production
# MAGIC 4. **Actionable recommendations** — Audit suggests cheaper models that match required capabilities
# MAGIC 5. **Automated remediation** — `inferwise fix` rewrites model IDs across the codebase in one command
# MAGIC 6. **Budget guardrails** — Three-tier enforcement (warn → approval → block) in CI/CD prevents cost surprises

# COMMAND ----------

# Build summary DataFrame from the data we collected
summary_data = []
for _, row in df_comparison.iterrows():
    summary_data.append({
        "Model": row["Model"],
        "Latency (s)": row["Latency (s)"],
        "Input Tokens": row["Input Tokens"],
        "Output Tokens": row["Output Tokens"],
    })

df_summary = pd.DataFrame(summary_data)
print("Model Performance Summary:")
display(df_summary)

print(f"\nStreaming Performance (gpt-5.4):")
print(f"  Time to first token: {first_token_time:.2f}s")
print(f"  Total streaming time: {total_stream_time:.2f}s")
print(f"  Non-streaming time: {latency_non_stream:.2f}s")
