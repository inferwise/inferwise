# inferwise

**Know your LLM costs before you commit.**

Inferwise is a FinOps CLI for LLM inference costs. Scan your codebase for LLM API calls, estimate token costs, and show cost diffs in pull requests.

## Quick Start

```bash
npx inferwise estimate .
```

Or install globally:

```bash
npm install -g inferwise
```

## Commands

### `inferwise estimate [path]`

Scan a directory for LLM API calls and estimate costs.

```bash
inferwise estimate .
inferwise estimate ./src --volume 5000
inferwise estimate . --format json
```

### `inferwise diff`

Compare token costs between two git refs.

```bash
inferwise diff
inferwise diff --base main --head HEAD
inferwise diff --fail-on-increase 500
```

### `inferwise update-pricing`

Check the freshness of the bundled pricing database.

## Supported Providers

Anthropic, OpenAI, Google AI, xAI — with LangChain and Vercel AI SDK pattern detection.

## Documentation

See the [main repo](https://github.com/inferwise/inferwise) for full documentation.

## License

Apache 2.0
