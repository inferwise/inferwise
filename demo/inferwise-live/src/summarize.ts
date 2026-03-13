import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Document summarization endpoint
// Using mid-tier model — good balance of quality and cost
export async function summarizeDocument(document: string) {
  const response = await client.chat.completions.create({
    model: "claude-sonnet-4-6",
    messages: [
      {
        role: "system",
        content:
          "Summarize the following document in 3-5 bullet points. Be concise.",
      },
      { role: "user", content: document },
    ],
    max_tokens: 512,
    temperature: 0,
  });

  return response.choices[0].message.content;
}

// Batch summarization for daily report digests
export async function summarizeBatch(documents: string[]) {
  const results = [];
  for (const doc of documents) {
    const summary = await client.chat.completions.create({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: `Summarize briefly: ${doc}` }],
      max_tokens: 256,
    });
    results.push(summary.choices[0].message.content);
  }
  return results;
}
