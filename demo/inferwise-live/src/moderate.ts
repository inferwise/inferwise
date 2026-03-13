import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Content moderation — scheduled scan of flagged user content
// Using GPT-4o but moderation is a simple classification task
export async function moderateContent() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Check if this content violates any policies. Respond with JSON: {safe: boolean, reason: string}" },
      { role: "user", content: "Review this user-submitted product listing: Brand new NVIDIA H100 GPU, factory sealed. Asking $35,000 OBO. Pickup only in San Jose area." },
    ],
    max_tokens: 64,
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content ?? '{"safe": true}');
}
