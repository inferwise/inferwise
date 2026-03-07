# Inferwise

Know your LLM costs before you commit.

Inferwise estimates token costs for your LLM API calls, shows cost diffs in PRs, and routes requests to the optimal model — all while keeping your team under budget.

## Quick Start

```bash
npx inferwise estimate .
```

## What It Does

- Scans your codebase for LLM API calls (Anthropic, OpenAI, Google, xAI)
- Estimates input/output token costs per provider and model
- Shows cost impact of prompt/model changes in pull requests
- Routes requests to the best model for your budget

## Installation

```bash
npm install -g inferwise
# or
pnpm add -g inferwise
```

## Commands

```bash
inferwise estimate .                        # Estimate costs for current directory
inferwise estimate . --format markdown      # Output as markdown table
inferwise estimate . --volume 5000          # Project at 5,000 req/day
inferwise diff --base main --head HEAD      # Cost diff between branches
inferwise audit .                           # Find optimization opportunities
```

## GitHub Action

Add to `.github/workflows/inferwise.yml`:

```yaml
- uses: inferwise/inferwise-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

Every PR gets a cost diff comment automatically.

## License

Apache 2.0 — see [LICENSE](LICENSE)
