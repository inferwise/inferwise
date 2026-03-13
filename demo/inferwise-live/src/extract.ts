import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Extract structured data from invoices
// Using GPT-4o but this is a straightforward extraction task
export async function extractInvoiceData(invoiceText: string) {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Extract the vendor name, invoice number, total amount, and due date from the invoice. Return as JSON.",
      },
      { role: "user", content: invoiceText },
    ],
    max_tokens: 256,
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content ?? "{}");
}

// Extract action items from meeting transcripts
export async function extractActionItems(transcript: string) {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Extract all action items from this meeting transcript. Return as a JSON array of {owner, task, deadline}.",
      },
      { role: "user", content: transcript },
    ],
    max_tokens: 1024,
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content ?? "[]");
}
