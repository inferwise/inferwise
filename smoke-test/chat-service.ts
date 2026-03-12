import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const anthropic = new Anthropic();
const openai = new OpenAI();

// Expensive: using Opus for simple classification
export async function classifyTicket(ticket: string) {
  const response = await anthropic.messages.create({
    model: "claude-opus-4-20250514",
    max_tokens: 256,
    system: "You are a support ticket classifier. Classify the ticket into one of: billing, technical, account, other. Return only the category name.",
    messages: [{ role: "user", content: ticket }],
  });
  return response;
}

// Reasonable: Sonnet for code generation
export async function generateCode(prompt: string) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: "You are an expert software engineer. Write clean, well-tested TypeScript code.",
    messages: [{ role: "user", content: prompt }],
  });
  return response;
}

// Using GPT-4o for summarization
export async function summarizeDocument(doc: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      { role: "system", content: "Summarize the following document in 2-3 sentences." },
      { role: "user", content: doc },
    ],
  });
  return response;
}
