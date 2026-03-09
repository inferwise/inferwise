import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanDirectory } from "./index.js";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "inferwise-scanner-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = path.join(tmpDir, filename);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("scanDirectory", () => {
  it("returns empty array for directory with no LLM calls", async () => {
    await writeFixture("empty.ts", 'const x = 1;\nconsole.log("hello");\n');
    const results = await scanDirectory(tmpDir);
    expect(results.filter((r) => r.filePath === "empty.ts")).toHaveLength(0);
  });

  it("detects Anthropic SDK messages.create with static model", async () => {
    await writeFixture(
      "anthropic-sdk.ts",
      `
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();
const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello!" }],
  max_tokens: 1024,
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "anthropic-sdk.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("claude-sonnet-4-20250514");
    expect(hit?.framework).toBe("anthropic-sdk");
    expect(hit?.systemPrompt).toBe("You are a helpful assistant.");
    expect(hit?.maxOutputTokens).toBe(1024);
  });

  it("detects OpenAI SDK chat.completions.create", async () => {
    await writeFixture(
      "openai-sdk.ts",
      `
import OpenAI from "openai";
const client = new OpenAI();
const completion = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What is 2+2?" }],
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "openai-sdk.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
    expect(hit?.model).toBe("gpt-4o");
    expect(hit?.framework).toBe("openai-sdk");
    expect(hit?.maxOutputTokens).toBeNull();
  });

  it("detects Vercel AI SDK generateText with provider factory", async () => {
    await writeFixture(
      "vercel-ai.ts",
      `
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  prompt: "Write a haiku about programming.",
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "vercel-ai.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("claude-sonnet-4-20250514");
    expect(hit?.framework).toBe("vercel-ai-sdk");
  });

  it("detects Vercel AI SDK streamText with openai provider", async () => {
    await writeFixture(
      "vercel-stream.ts",
      `
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
const result = streamText({
  model: openai("gpt-4o-mini"),
  system: "You are a coding assistant.",
  prompt: "Fix this bug.",
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "vercel-stream.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
    expect(hit?.model).toBe("gpt-4o-mini");
    expect(hit?.systemPrompt).toBe("You are a coding assistant.");
  });

  it("detects LangChain ChatAnthropic", async () => {
    await writeFixture(
      "langchain.ts",
      `
import { ChatAnthropic } from "@langchain/anthropic";
const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  maxTokens: 512,
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "langchain.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("claude-haiku-4-5-20251001");
    expect(hit?.framework).toBe("langchain");
    expect(hit?.maxOutputTokens).toBe(512);
  });

  it("detects LangChain ChatOpenAI", async () => {
    await writeFixture(
      "langchain-openai.ts",
      `
import { ChatOpenAI } from "@langchain/openai";
const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "langchain-openai.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
    expect(hit?.model).toBe("gpt-4o");
  });

  it("detects Python Anthropic SDK", async () => {
    await writeFixture(
      "anthropic_script.py",
      `
import anthropic

client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-opus-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, world"}],
)
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "anthropic_script.py");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("claude-opus-4-20250514");
    expect(hit?.maxOutputTokens).toBe(1024);
  });

  it("detects Python OpenAI SDK", async () => {
    await writeFixture(
      "openai_script.py",
      `
from openai import OpenAI

client = OpenAI()
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is 1+1?"}],
)
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "openai_script.py");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
    expect(hit?.model).toBe("gpt-4o-mini");
  });

  it("marks result as dynamic when model is not statically declared", async () => {
    await writeFixture(
      "dynamic-model.ts",
      `
const model = process.env.MODEL_ID ?? "fallback";
const response = await client.messages.create({
  model,
  messages: [{ role: "user", content: "Hello" }],
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "dynamic-model.ts");
    // provider is anthropic (from messages.create), but model is dynamic
    if (hit) {
      expect(hit.isDynamic).toBe(true);
      expect(hit.model).toBeNull();
    }
  });

  it("skips test files", async () => {
    await writeFixture(
      "service.test.ts",
      `
await client.messages.create({ model: "claude-sonnet-4-20250514", messages: [] });
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "service.test.ts");
    expect(hit).toBeUndefined();
  });

  it("detects multiple calls in the same file", async () => {
    await writeFixture(
      "multi-call.ts",
      `
const r1 = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  messages: [{ role: "user", content: "Short task" }],
});

const r2 = await client.messages.create({
  model: "claude-opus-4-20250514",
  messages: [{ role: "user", content: "Complex task" }],
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hits = results.filter((r) => r.filePath === "multi-call.ts");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const models = hits.map((h) => h.model);
    expect(models).toContain("claude-haiku-4-5-20251001");
    expect(models).toContain("claude-opus-4-20250514");
  });

  it("results are sorted by file path then line number", async () => {
    const results = await scanDirectory(tmpDir);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const curr = results[i];
      if (!prev || !curr) continue;
      const fileOrder = prev.filePath.localeCompare(curr.filePath);
      if (fileOrder === 0) {
        expect(prev.lineNumber).toBeLessThanOrEqual(curr.lineNumber);
      } else {
        expect(fileOrder).toBeLessThanOrEqual(0);
      }
    }
  });

  it("extracts max_output_tokens from Google GenAI calls", async () => {
    await writeFixture(
      "google-genai.ts",
      `
import { GoogleGenerativeAI } from "@google/generative-ai";
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genai.GenerativeModel({
  model: "gemini-2.5-pro",
  max_output_tokens: 256,
});
const result = await model.generateContent("Summarize this.");
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "google-genai.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("google");
    expect(hit?.maxOutputTokens).toBe(256);
  });

  it("extracts maxTokens from Vercel AI SDK calls", async () => {
    await writeFixture(
      "vercel-max-tokens.ts",
      `
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
const { text } = await generateText({
  model: openai("gpt-4o"),
  maxTokens: 200,
  prompt: "Classify this text.",
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "vercel-max-tokens.ts");
    expect(hit).toBeDefined();
    expect(hit?.maxOutputTokens).toBe(200);
  });

  it("detects AWS Bedrock invoke_model call", async () => {
    await writeFixture(
      "bedrock-sdk.py",
      `
import boto3, json
client = boto3.client("bedrock-runtime")
response = client.invoke_model(
    modelId="anthropic.claude-sonnet-4-20250514-v1:0",
    body=json.dumps({"prompt": "Hello"}),
)
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "bedrock-sdk.py");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("anthropic.claude-sonnet-4-20250514-v1:0");
    expect(hit?.framework).toBe("bedrock-sdk");
  });

  it("detects LiteLLM completion with bedrock prefix", async () => {
    await writeFixture(
      "litellm-call.py",
      `
import litellm
response = litellm.completion(
    model="bedrock/anthropic.claude-sonnet-4-20250514-v1:0",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=256,
)
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "litellm-call.py");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("bedrock/anthropic.claude-sonnet-4-20250514-v1:0");
    expect(hit?.framework).toBe("litellm");
    expect(hit?.maxOutputTokens).toBe(256);
  });

  it("detects LangChain ChatBedrock", async () => {
    await writeFixture(
      "langchain-bedrock.ts",
      `
import { ChatBedrock } from "@langchain/community/chat_models/bedrock";
const llm = new ChatBedrock({
    model: "anthropic.claude-sonnet-4-20250514-v1:0",
    region: "us-east-1",
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "langchain-bedrock.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("anthropic");
    expect(hit?.model).toBe("anthropic.claude-sonnet-4-20250514-v1:0");
    expect(hit?.framework).toBe("langchain");
  });

  it("detects LangChain AzureChatOpenAI", async () => {
    await writeFixture(
      "langchain-azure.ts",
      `
import { AzureChatOpenAI } from "@langchain/openai";
const llm = new AzureChatOpenAI({
    model: "gpt-4o",
    azureOpenAIApiDeploymentName: "my-deployment",
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === "langchain-azure.ts");
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
    expect(hit?.model).toBe("gpt-4o");
    expect(hit?.framework).toBe("langchain");
  });

  it("detects Azure OpenAI SDK", async () => {
    await writeFixture(
      "azure-openai.ts",
      `
import { AzureOpenAI } from "openai";
const client = new AzureOpenAI({ endpoint, apiKey, apiVersion });
const result = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
});
`,
    );

    const results = await scanDirectory(tmpDir);
    const hits = results.filter((r) => r.filePath === "azure-openai.ts");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.provider === "openai")).toBe(true);
  });

  it("handles subdirectories", async () => {
    const subDir = path.join(tmpDir, "sub");
    await mkdir(subDir, { recursive: true });
    await writeFile(
      path.join(subDir, "nested.ts"),
      `
await openai.chat.completions.create({ model: "gpt-4o", messages: [] });
`,
      "utf-8",
    );

    const results = await scanDirectory(tmpDir);
    const hit = results.find((r) => r.filePath === path.join("sub", "nested.ts"));
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe("openai");
  });
});
