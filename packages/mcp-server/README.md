# @inferwise/mcp

MCP server for Inferwise — gives AI agents tools to estimate LLM costs, suggest cheaper models, and audit codebases for cost optimization.

Works with any AI tool that supports the [Model Context Protocol](https://modelcontextprotocol.io): Claude Code, Cursor, VS Code (1.99+), Windsurf, Cline, and more.

## Setup

### Claude Code

```bash
claude mcp add inferwise -- npx -y @inferwise/mcp
```

### Cursor / VS Code / Windsurf

Add to your MCP settings (`.cursor/mcp.json`, `.vscode/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "inferwise": {
      "command": "npx",
      "args": ["-y", "@inferwise/mcp"]
    }
  }
}
```

### Cline

Add to Cline MCP settings:

```json
{
  "mcpServers": {
    "inferwise": {
      "command": "npx",
      "args": ["-y", "@inferwise/mcp"]
    }
  }
}
```

## Tools

Once connected, the AI agent gets three tools:

### `suggest_model`

Suggest the cheapest LLM model capable of handling a given task. Analyzes the task description using keyword-based pattern matching to infer required capabilities (`code`, `reasoning`, `general`, `creative`, `vision`, `search`, `audio`), then finds the cheapest model across all providers that has those capabilities. If no specific capabilities are detected, defaults to `general`.

**Input:**
- `task` (string, required) — Description of what you want the LLM to do
- `provider` (string, optional) — Restrict to a specific provider (`anthropic`, `openai`, `google`, `xai`, `perplexity`)
- `maxCostPerMillionTokens` (number, optional) — Maximum acceptable cost per million output tokens (USD)

**Returns:** Recommended model with pricing, up to 3 cheaper alternatives, inferred capabilities, and reasoning.

**Example:** Agent asks "classify support tickets by category" → Inferwise infers `["general"]` capability → returns `gpt-4o-mini` at $0.60/MTok instead of `gpt-4o` at $10/MTok.

See the [main repo](https://github.com/inferwise/inferwise#how-model-selection-works) for details on capability inference and cross-provider ranking.

### `estimate_cost`

Estimate the cost of an LLM API call given provider, model, and token counts. Optionally projects monthly costs based on daily request volume.

**Input:**
- `provider` (string, required) — LLM provider
- `model` (string, required) — Model ID (e.g., `claude-sonnet-4-6`, `gpt-4o`)
- `inputTokens` (number, required) — Number of input tokens
- `outputTokens` (number, required) — Number of output tokens
- `requestsPerDay` (number, optional) — Daily volume for monthly projection
- `useBatch` (boolean, optional) — Use Batch API pricing
- `useCache` (boolean, optional) — Assume cache-hit pricing

**Returns:** Cost per call, monthly projection, and pricing breakdown.

### `audit`

Scan a directory for LLM API calls, estimate costs, and suggest cheaper capable models for each call site.

**Input:**
- `directory` (string, required) — Absolute path to the directory to scan
- `volume` (number, optional) — Requests per day for monthly projection (default: 1000)

**Returns:** Per-call-site cost estimates, total monthly cost, unknown models, and smart model recommendations with savings percentages.

## How It Works

The MCP server runs locally as a subprocess — no hosted infrastructure, no API keys needed for basic usage. It communicates via stdio using the MCP protocol (JSON-RPC over stdin/stdout).

The server depends on:
- [`@inferwise/pricing-db`](../pricing-db) — bundled pricing for 35+ models across 5 providers
- [`inferwise`](../cli) — code scanner and cost estimation engine

## Non-MCP Alternatives

If your tool doesn't support MCP, use the CLI directly:

```bash
# JSON output for programmatic consumption
inferwise audit . --format json
inferwise price openai gpt-4o --format json

# SDK for embedding in pipelines
import { estimate } from "inferwise/sdk";
```

## License

Apache 2.0
