import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Main chat endpoint — handles complex user queries
// Using premium-tier model for maximum reasoning depth
export async function handleChat(userQuery: string) {
  const response = await client.chat.completions.create({
    model: "claude-opus-4-7",
    messages: [
      { role: "system", content: "You are an IT cost analyst assistant for a large enterprise. Provide detailed, accurate analysis." },
      { role: "user", content: userQuery },
    ],
    max_tokens: 2048,
    temperature: 0,
  });

  return response.choices[0].message.content;
}
