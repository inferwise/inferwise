# @inferwise/github-action

GitHub Action that scans your codebase for LLM API calls and posts a cost diff comment on pull requests.

## Usage

```yaml
name: Cost Diff
on: [pull_request]

jobs:
  cost-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: inferwise/inferwise-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for posting PR comments | Yes | `${{ github.token }}` |
| `base-ref` | Base git ref to compare against | No | PR base branch |
| `volume` | Requests/day for monthly cost projection | No | `1000` |
| `fail-on-increase` | Fail if monthly cost increases by more than this USD amount | No | — |
| `working-directory` | Directory to scan | No | `.` |

## Outputs

| Output | Description |
|--------|-------------|
| `net-monthly-delta` | Net monthly cost delta in USD (negative = savings) |
| `report` | Full cost diff report in markdown format |

## Example PR Comment

```markdown
## Inferwise Cost Report

| File | Model | Change | Monthly Impact |
|------|-------|--------|----------------|
| `src/chat.ts` | claude-opus-4 -> claude-sonnet-4 | Modified | -$13,500/mo |
| `src/summarize.ts` | (new) gpt-4o | Added | +$2,400/mo |

**Net monthly impact: -$11,100/mo**
```

## Cost Gate

Use `fail-on-increase` to block PRs that exceed a cost threshold:

```yaml
- uses: inferwise/inferwise-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-increase: "500"
```

This exits with code 1 if the monthly cost increase exceeds $500.

## License

Apache-2.0
