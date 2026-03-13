import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://inference-api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

// Extract structured data from invoices — nightly batch job
// Using GPT-4o but this is a straightforward extraction task
export async function extractInvoiceData() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Extract the vendor name, invoice number, total amount, and due date from the invoice. Return as JSON." },
      { role: "user", content: "INVOICE #INV-2024-8837 From: Acme Cloud Services LLC Bill To: Contoso Corp Date: 2024-12-01 Due: 2024-12-31 Description: Enterprise GPU cluster (8x A100) December 2024 Amount: $184,320.00 Total Due: $184,320.00" },
    ],
    max_tokens: 256,
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content ?? "{}");
}

// Extract action items from meeting transcripts — scheduled after each standup
export async function extractActionItems() {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Extract all action items from this meeting transcript. Return as a JSON array of {owner, task, deadline}." },
      { role: "user", content: "Meeting: Weekly Infra Standup 2024-12-09 Sarah: GPU quota request pending with AWS, will follow up by Wednesday. Mike: K8s autoscaler needs tuning, 3 OOM kills last night, fix by Thursday. Priya: Cost dashboard missing Anthropic breakdown, target Friday." },
    ],
    max_tokens: 1024,
    temperature: 0,
  });

  return JSON.parse(response.choices[0].message.content ?? "[]");
}
