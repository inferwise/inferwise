# Token Estimation Heuristics

This document explains how Inferwise estimates token counts when exact values cannot be extracted from code.

## The Problem

When scanning code for LLM API calls, Inferwise can extract exact token counts in two cases:

1. **Static prompts** — system/user prompts defined as string literals in code. These are tokenized for exact input counts.
2. **`max_tokens` parameter** — when set explicitly in code, this gives exact maximum output counts.

For dynamic prompts (variables, template strings, runtime data) and calls without `max_tokens`, Inferwise must estimate. Previously, we used worst-case ceilings from model specs (e.g., `context_window - max_output_tokens` for input), which produced wildly inaccurate estimates — often 1000x+ higher than actual usage.

## Typical Estimation Methodology

Instead of worst-case ceilings, Inferwise now uses **typical estimates** based on observed industry patterns. These estimates are intentionally conservative (higher than median) to avoid underestimation, while being orders of magnitude more accurate than context-window ceilings.

### Input Tokens (no static prompt found)

**Default: 4,096 tokens**

Rationale:
- Median production LLM input is ~2K-8K tokens across most use cases
- Chat/conversational inputs average 500-2K tokens
- RAG/retrieval-augmented prompts average 4K-12K tokens (retrieved context + query)
- Code generation prompts average 1K-4K tokens
- 4,096 represents a reasonable middle ground across use cases

**Exception:** For models with small context windows (<16K), we use 25% of the context window to avoid overestimating for constrained models.

### Output Tokens (no `max_tokens` in code)

**Formula: 5% of `max_output_tokens`, clamped to [512, 4096]**

Examples:
| Model | max_output_tokens | Typical estimate |
|-------|-------------------|-----------------|
| Claude Haiku 3.5 | 8,192 | 512 |
| GPT-4o | 16,384 | 820 |
| Claude Sonnet 4 | 64,000 | 3,200 |
| Gemini 2.5 Flash | 65,536 | 3,277 |

Rationale:
- Median LLM output across production workloads is ~500-2K tokens
- Chat responses average 200-800 tokens
- Code generation averages 500-2K tokens
- Long-form content (summaries, reports) averages 1K-3K tokens
- 5% of max capacity, with a floor of 512 and ceiling of 4,096, covers these ranges

## Sources

These heuristics are informed by:

1. **Anthropic token counting guidance** — Anthropic's documentation on prompt design recommends budgeting 1K-4K tokens for typical prompts. [docs.anthropic.com](https://docs.anthropic.com)

2. **OpenAI tokenizer documentation** — OpenAI's cookbook examples show typical prompts ranging from hundreds to low thousands of tokens. [platform.openai.com/tokenizer](https://platform.openai.com/tokenizer)

3. **Helicone public analytics** — Helicone (open-source LLM observability) publishes aggregate usage patterns showing median request sizes well below context limits. [helicone.ai](https://helicone.ai)

4. **LangSmith production traces** — LangChain's observability platform reports on typical token usage patterns across production LLM applications.

5. **Industry surveys** — Multiple developer surveys (Retool State of AI 2024, Stack Overflow Developer Survey 2024) report that most LLM integrations use small-to-medium prompts, not context-window-filling inputs.

## How to Get Exact Estimates

Typical estimates are marked with `≈` in Inferwise output. For exact estimates:

1. **Set `max_tokens`** in your API calls — this gives Inferwise an exact output ceiling
2. **Use static prompts** where possible — Inferwise tokenizes these for exact input counts
3. **Run `inferwise calibrate`** — fetches actual usage from provider APIs and stores correction factors
4. **Connect to Inferwise Cloud** — uses production telemetry for real-time averages

## Accuracy Expectations

| Source | Marker | Accuracy |
|--------|--------|----------|
| `code` (static prompt / max_tokens) | (none) | Exact |
| `typical` (heuristic) | ≈ | Within 2-5x of actual (vs 100-2000x for old ceiling) |
| `calibrated` (provider API data) | ~ | Within 20% of actual |
| `production` (Inferwise Cloud) | † | Within 10% of actual |

## Updating Heuristics

These defaults may be refined as we collect more data. If your use case consistently diverges from typical estimates, use `inferwise calibrate` to apply correction factors based on your actual usage patterns.
