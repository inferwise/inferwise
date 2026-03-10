# @inferwise/github-action

GitHub Action that scans your codebase for LLM API calls, posts a cost diff comment on pull requests, and enforces budget policies.

## Usage

```yaml
name: Inferwise Cost Diff
on: [pull_request]

jobs:
  cost-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
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
| `github-token` | GitHub token for posting PR comments and labels | Yes | `${{ github.token }}` |
| `base-ref` | Base git ref to compare against | No | PR base branch |
| `volume` | Requests/day for monthly cost projection | No | `1000` |
| `fail-on-increase` | Fail if monthly cost increases by more than this USD amount | No | — |
| `working-directory` | Directory to scan | No | `.` |

## Outputs

| Output | Description |
|--------|-------------|
| `net-monthly-delta` | Net monthly cost delta in USD (negative = savings) |
| `report` | Full cost diff report in markdown format |

## Budget Enforcement

The Action reads `inferwise.config.json` from your repo root for budget thresholds:

```json
{
  "budgets": {
    "warn": 2000,
    "block": 50000,
    "requireApproval": 10000,
    "approvers": ["platform-eng", "@infra-team"]
  }
}
```

**What happens at each threshold:**

| Threshold | Label | Action |
|-----------|-------|--------|
| `warn` | `cost-warning` (yellow) | Warning comment on PR |
| `requireApproval` | `cost-approval-required` (orange) | Requests review from `approvers` |
| `block` | `cost-blocked` (red) | Fails the check, blocks merge |

Budget thresholds are monthly cost increase in USD. The `block` default ($50,000) is deliberately high — it's an emergency brake for catastrophic changes, not routine increases.

You can also use the `fail-on-increase` input for a simpler threshold without config:

```yaml
- uses: inferwise/inferwise-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on-increase: "500"
```

## Example PR Comment

```markdown
## Inferwise Cost Report

| File | Model | Change | Monthly Impact |
|------|-------|--------|----------------|
| `src/chat.ts` | claude-opus-4 -> claude-sonnet-4 | Modified | -$13,500/mo |
| `src/summarize.ts` | (new) gpt-4o | Added | +$2,400/mo |

**Net monthly impact: -$11,100/mo**
```

## Not Using GitHub?

The CLI works with any CI system. See the [main repo](https://github.com/inferwise/inferwise#ci-setup) for GitLab CI, Bitbucket Pipelines, and generic CI setup.

## License

Apache-2.0
