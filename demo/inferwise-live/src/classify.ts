import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Ticket classification — routes support tickets to the right team
// Developer picked GPT-4o for "accuracy" but this is a simple task
export async function classifyTicket() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Classify the support ticket into one of: billing, technical, account, general. Respond with just the category name." },
      { role: "user", content: "I was charged twice for my subscription last month and need a refund. My account number is 4821." },
    ],
    max_tokens: 16,
    temperature: 0,
  });

  return response.choices[0].message.content;
}
