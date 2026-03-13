import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Document summarization endpoint — interactive, user uploads docs
// Using mid-tier model — good balance of quality and cost
export async function summarizeDocument(document: string) {
  const response = await client.chat.completions.create({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "Summarize the following document in 3-5 bullet points. Be concise." },
      { role: "user", content: document },
    ],
    max_tokens: 512,
    temperature: 0,
  });

  return response.choices[0].message.content;
}

// Batch summarization for daily report digests — scheduled cron job
export async function summarizeBatch() {
  const response = await client.chat.completions.create({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "Summarize the following quarterly financial report in 3-5 key takeaways for the executive team." },
      { role: "user", content: "Q4 2024 Financial Summary: Revenue $42.3M (+18% YoY), COGS $28.1M, Gross Margin 33.6%. Cloud infra spend $8.2M (+34% YoY) driven by GPU compute. Headcount 847 (+52). Key risks: GPU supply constraints through Q2 2025, 3 enterprise renewals ($12M ARR) in Q1." },
    ],
    max_tokens: 256,
  });

  return response.choices[0].message.content;
}
