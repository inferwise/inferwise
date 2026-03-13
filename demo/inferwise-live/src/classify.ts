import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Ticket classification — routes support tickets to the right team
// Using budget-tier model — classification is a simple task
export async function classifyTicket(ticketText: string) {
  const response = await client.chat.completions.create({
    model: "gcp/google/gemini-3-pro",
    messages: [
      {
        role: "system",
        content:
          'Classify the support ticket into one of: billing, technical, account, general. Respond with just the category name.',
      },
      { role: "user", content: ticketText },
    ],
    max_tokens: 16,
    temperature: 0,
  });

  return response.choices[0].message.content;
}
