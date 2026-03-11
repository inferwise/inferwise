import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleAudit } from "./tools/audit.js";
import { handleEstimateCost } from "./tools/estimate-cost.js";
import { handleSuggestModel } from "./tools/suggest-model.js";

const server = new McpServer({
  name: "inferwise",
  version: "0.2.1",
});

// ── suggest_model ────────────────────────────────────────────────────

server.tool(
  "suggest_model",
  "Suggest the cheapest LLM model capable of handling a given task. Returns a recommended model with pricing, alternatives, and reasoning based on inferred capabilities.",
  {
    task: z.string().describe("Description of what you want the LLM to do"),
    provider: z
      .enum(["anthropic", "openai", "google", "xai", "perplexity"])
      .optional()
      .describe("Restrict suggestions to a specific provider"),
    maxCostPerMillionTokens: z
      .number()
      .optional()
      .describe("Maximum acceptable cost per million output tokens (USD)"),
  },
  async (input) => {
    const result = handleSuggestModel(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── estimate_cost ────────────────────────────────────────────────────

server.tool(
  "estimate_cost",
  "Estimate the cost of an LLM API call given provider, model, and token counts. Optionally project monthly costs based on daily request volume.",
  {
    provider: z
      .enum(["anthropic", "openai", "google", "xai", "perplexity"])
      .describe("LLM provider"),
    model: z.string().describe("Model ID (e.g., 'claude-sonnet-4-6', 'gpt-4o')"),
    inputTokens: z.number().describe("Number of input tokens"),
    outputTokens: z.number().describe("Number of output tokens"),
    requestsPerDay: z
      .number()
      .optional()
      .describe("Daily request volume for monthly cost projection"),
    useBatch: z.boolean().optional().describe("Use Batch API pricing if available"),
    useCache: z.boolean().optional().describe("Assume all input is cache-hit pricing"),
  },
  async (input) => {
    const result = handleEstimateCost(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── audit ────────────────────────────────────────────────────────────

server.tool(
  "audit",
  "Scan a directory for LLM API calls, estimate costs, and suggest cheaper capable models. Returns cost estimates per call site with smart model recommendations.",
  {
    directory: z.string().describe("Absolute path to the directory to scan"),
    volume: z
      .number()
      .optional()
      .describe("Requests per day for monthly cost projection (default: 1000)"),
  },
  async (input) => {
    const result = await handleAudit(input);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Start ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Inferwise MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
