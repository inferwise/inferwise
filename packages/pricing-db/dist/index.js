// providers/anthropic.json
var anthropic_default = {
  provider: "anthropic",
  last_updated: "2026-03-07",
  last_verified: "2026-03-07",
  source: "https://platform.claude.com/docs/en/docs/about-claude/models/overview",
  models: [
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      aliases: [
        "claude-opus-4-6-20250805"
      ],
      status: "current",
      input_cost_per_million: 5,
      output_cost_per_million: 25,
      cache_read_input_cost_per_million: 0.5,
      cache_write_input_cost_per_million: 6.25,
      batch_input_cost_per_million: 2.5,
      batch_output_cost_per_million: 12.5,
      input_cost_above_200k_per_million: 10,
      output_cost_above_200k_per_million: 37.5,
      context_window: 1e6,
      max_output_tokens: 128e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-05-01"
    },
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      aliases: [],
      status: "current",
      input_cost_per_million: 3,
      output_cost_per_million: 15,
      cache_read_input_cost_per_million: 0.3,
      cache_write_input_cost_per_million: 3.75,
      batch_input_cost_per_million: 1.5,
      batch_output_cost_per_million: 7.5,
      input_cost_above_200k_per_million: 6,
      output_cost_above_200k_per_million: 22.5,
      context_window: 2e5,
      max_output_tokens: 64e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-08-01"
    },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      aliases: [
        "claude-haiku-4-5"
      ],
      status: "current",
      input_cost_per_million: 1,
      output_cost_per_million: 5,
      cache_read_input_cost_per_million: 0.1,
      cache_write_input_cost_per_million: 1.25,
      batch_input_cost_per_million: 0.5,
      batch_output_cost_per_million: 2.5,
      context_window: 2e5,
      max_output_tokens: 64e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ],
      knowledge_cutoff: "2025-02-01"
    },
    {
      id: "claude-sonnet-4-5-20250929",
      name: "Claude Sonnet 4.5",
      aliases: [
        "claude-sonnet-4-5"
      ],
      status: "legacy",
      input_cost_per_million: 3,
      output_cost_per_million: 15,
      cache_read_input_cost_per_million: 0.3,
      cache_write_input_cost_per_million: 3.75,
      batch_input_cost_per_million: 1.5,
      batch_output_cost_per_million: 7.5,
      input_cost_above_200k_per_million: 6,
      output_cost_above_200k_per_million: 22.5,
      context_window: 2e5,
      max_output_tokens: 64e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-01-01"
    },
    {
      id: "claude-opus-4-5-20251101",
      name: "Claude Opus 4.5",
      aliases: [
        "claude-opus-4-5"
      ],
      status: "legacy",
      input_cost_per_million: 5,
      output_cost_per_million: 25,
      cache_read_input_cost_per_million: 0.5,
      cache_write_input_cost_per_million: 6.25,
      batch_input_cost_per_million: 2.5,
      batch_output_cost_per_million: 12.5,
      context_window: 2e5,
      max_output_tokens: 64e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-05-01"
    },
    {
      id: "claude-opus-4-1-20250805",
      name: "Claude Opus 4.1",
      aliases: [
        "claude-opus-4-1"
      ],
      status: "legacy",
      input_cost_per_million: 15,
      output_cost_per_million: 75,
      cache_read_input_cost_per_million: 1.5,
      cache_write_input_cost_per_million: 18.75,
      batch_input_cost_per_million: 7.5,
      batch_output_cost_per_million: 37.5,
      context_window: 2e5,
      max_output_tokens: 32e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-01-01"
    },
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      aliases: [
        "claude-sonnet-4-0"
      ],
      status: "legacy",
      input_cost_per_million: 3,
      output_cost_per_million: 15,
      cache_read_input_cost_per_million: 0.3,
      cache_write_input_cost_per_million: 3.75,
      batch_input_cost_per_million: 1.5,
      batch_output_cost_per_million: 7.5,
      input_cost_above_200k_per_million: 6,
      output_cost_above_200k_per_million: 22.5,
      context_window: 1e6,
      max_output_tokens: 64e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-01-01"
    },
    {
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      aliases: [
        "claude-opus-4-0"
      ],
      status: "legacy",
      input_cost_per_million: 15,
      output_cost_per_million: 75,
      cache_read_input_cost_per_million: 1.5,
      cache_write_input_cost_per_million: 18.75,
      batch_input_cost_per_million: 7.5,
      batch_output_cost_per_million: 37.5,
      context_window: 2e5,
      max_output_tokens: 32e3,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: true,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ],
      knowledge_cutoff: "2025-01-01"
    },
    {
      id: "claude-3-haiku-20240307",
      name: "Claude Haiku 3",
      aliases: [],
      status: "deprecated",
      input_cost_per_million: 0.25,
      output_cost_per_million: 1.25,
      cache_read_input_cost_per_million: 0.03,
      cache_write_input_cost_per_million: 0.3,
      batch_input_cost_per_million: 0.125,
      batch_output_cost_per_million: 0.625,
      context_window: 2e5,
      max_output_tokens: 4096,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ],
      knowledge_cutoff: "2023-08-01"
    }
  ]
};

// providers/google.json
var google_default = {
  provider: "google",
  last_updated: "2026-03-07",
  last_verified: "2026-03-07",
  source: "https://ai.google.dev/pricing",
  models: [
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      aliases: [
        "gemini-2.5-pro-preview"
      ],
      status: "current",
      input_cost_per_million: 1.25,
      output_cost_per_million: 10,
      cache_read_input_cost_per_million: 0.125,
      input_cost_above_200k_per_million: 2.5,
      output_cost_above_200k_per_million: 15,
      context_window: 1048576,
      max_output_tokens: 65535,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ]
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      aliases: [
        "gemini-2.5-flash-preview"
      ],
      status: "current",
      input_cost_per_million: 0.3,
      output_cost_per_million: 2.5,
      cache_read_input_cost_per_million: 0.03,
      context_window: 1048576,
      max_output_tokens: 65535,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision",
        "reasoning"
      ]
    },
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      aliases: [
        "gemini-2.0-flash-001"
      ],
      status: "current",
      input_cost_per_million: 0.1,
      output_cost_per_million: 0.4,
      cache_read_input_cost_per_million: 0.025,
      context_window: 1048576,
      max_output_tokens: 8192,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ]
    },
    {
      id: "gemini-2.0-flash-lite",
      name: "Gemini 2.0 Flash Lite",
      aliases: [],
      status: "current",
      input_cost_per_million: 0.075,
      output_cost_per_million: 0.3,
      context_window: 1048576,
      max_output_tokens: 8192,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ],
      cache_read_input_cost_per_million: 0.0188
    },
    {
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      aliases: [
        "gemini-1.5-pro-002"
      ],
      status: "legacy",
      input_cost_per_million: 3.5,
      output_cost_per_million: 10.5,
      cache_read_input_cost_per_million: 0.3125,
      input_cost_above_200k_per_million: 2.5,
      output_cost_above_200k_per_million: 10,
      context_window: 2097152,
      max_output_tokens: 8192,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ]
    },
    {
      id: "gemini-1.5-flash",
      name: "Gemini 1.5 Flash",
      aliases: [
        "gemini-1.5-flash-002"
      ],
      status: "legacy",
      input_cost_per_million: 0.075,
      output_cost_per_million: 0.3,
      cache_read_input_cost_per_million: 0.01875,
      context_window: 1048576,
      max_output_tokens: 8192,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ]
    }
  ]
};

// providers/openai.json
var openai_default = {
  provider: "openai",
  last_updated: "2026-03-07",
  last_verified: "2026-03-07",
  source: "https://platform.openai.com/docs/pricing",
  models: [
    {
      id: "gpt-4o",
      name: "GPT-4o",
      aliases: [
        "gpt-4o-2024-11-20"
      ],
      status: "current",
      input_cost_per_million: 2.5,
      output_cost_per_million: 10,
      cache_read_input_cost_per_million: 1.25,
      batch_input_cost_per_million: 1.25,
      batch_output_cost_per_million: 5,
      context_window: 128e3,
      max_output_tokens: 16384,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ]
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      aliases: [
        "gpt-4o-mini-2024-07-18"
      ],
      status: "current",
      input_cost_per_million: 0.15,
      output_cost_per_million: 0.6,
      cache_read_input_cost_per_million: 0.075,
      batch_input_cost_per_million: 0.075,
      batch_output_cost_per_million: 0.3,
      context_window: 128e3,
      max_output_tokens: 16384,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "vision"
      ]
    },
    {
      id: "o3",
      name: "OpenAI o3",
      aliases: [
        "o3-2025-04-16"
      ],
      status: "current",
      input_cost_per_million: 2,
      output_cost_per_million: 8,
      cache_read_input_cost_per_million: 0.5,
      batch_input_cost_per_million: 5,
      batch_output_cost_per_million: 20,
      context_window: 2e5,
      max_output_tokens: 1e5,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general"
      ]
    },
    {
      id: "o3-mini",
      name: "OpenAI o3-mini",
      aliases: [
        "o3-mini-2025-01-31"
      ],
      status: "current",
      input_cost_per_million: 1.1,
      output_cost_per_million: 4.4,
      cache_read_input_cost_per_million: 0.55,
      batch_input_cost_per_million: 0.55,
      batch_output_cost_per_million: 2.2,
      context_window: 2e5,
      max_output_tokens: 1e5,
      supports_vision: false,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning"
      ]
    },
    {
      id: "o4-mini",
      name: "OpenAI o4-mini",
      aliases: [
        "o4-mini-2025-04-16"
      ],
      status: "current",
      input_cost_per_million: 1.1,
      output_cost_per_million: 4.4,
      cache_read_input_cost_per_million: 0.275,
      batch_input_cost_per_million: 0.55,
      batch_output_cost_per_million: 2.2,
      context_window: 2e5,
      max_output_tokens: 1e5,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "vision"
      ]
    },
    {
      id: "o1",
      name: "OpenAI o1",
      aliases: [
        "o1-2024-12-17"
      ],
      status: "legacy",
      input_cost_per_million: 15,
      output_cost_per_million: 60,
      cache_read_input_cost_per_million: 7.5,
      batch_input_cost_per_million: 7.5,
      batch_output_cost_per_million: 30,
      context_window: 2e5,
      max_output_tokens: 1e5,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general"
      ]
    },
    {
      id: "o1-mini",
      name: "OpenAI o1-mini",
      aliases: [
        "o1-mini-2024-09-12"
      ],
      status: "legacy",
      input_cost_per_million: 1.1,
      output_cost_per_million: 4.4,
      cache_read_input_cost_per_million: 0.55,
      context_window: 128e3,
      max_output_tokens: 65536,
      supports_vision: true,
      supports_tools: false,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning"
      ]
    },
    {
      id: "gpt-4-turbo",
      name: "GPT-4 Turbo",
      aliases: [
        "gpt-4-turbo-2024-04-09"
      ],
      status: "legacy",
      input_cost_per_million: 10,
      output_cost_per_million: 30,
      context_window: 128e3,
      max_output_tokens: 4096,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "premium",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative",
        "vision"
      ]
    }
  ]
};

// providers/xai.json
var xai_default = {
  provider: "xai",
  last_updated: "2026-03-07",
  last_verified: "2026-03-07",
  source: "https://docs.x.ai/docs/models",
  models: [
    {
      id: "grok-3",
      name: "Grok 3",
      aliases: [],
      status: "current",
      input_cost_per_million: 3,
      output_cost_per_million: 15,
      cache_read_input_cost_per_million: 0.75,
      batch_input_cost_per_million: 1.5,
      batch_output_cost_per_million: 7.5,
      context_window: 131072,
      max_output_tokens: 131072,
      supports_vision: false,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general",
        "creative"
      ]
    },
    {
      id: "grok-3-mini",
      name: "Grok 3 Mini",
      aliases: [],
      status: "current",
      input_cost_per_million: 0.3,
      output_cost_per_million: 0.5,
      cache_read_input_cost_per_million: 0.075,
      batch_input_cost_per_million: 0.15,
      batch_output_cost_per_million: 0.25,
      context_window: 131072,
      max_output_tokens: 131072,
      supports_vision: false,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: true,
      supports_computer_use: false,
      tier: "budget",
      capabilities: [
        "code",
        "general",
        "reasoning"
      ]
    },
    {
      id: "grok-3-vision",
      name: "Grok 3 Vision",
      aliases: [],
      status: "current",
      input_cost_per_million: 3,
      output_cost_per_million: 15,
      cache_read_input_cost_per_million: 0.75,
      context_window: 32768,
      max_output_tokens: 16384,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: true,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "general",
        "vision"
      ]
    },
    {
      id: "grok-2",
      name: "Grok 2",
      aliases: [
        "grok-2-1212"
      ],
      status: "legacy",
      input_cost_per_million: 2,
      output_cost_per_million: 10,
      context_window: 131072,
      max_output_tokens: 131072,
      supports_vision: false,
      supports_tools: true,
      supports_prompt_caching: false,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "reasoning",
        "general"
      ]
    },
    {
      id: "grok-2-vision",
      name: "Grok 2 Vision",
      aliases: [
        "grok-2-vision-1212"
      ],
      status: "legacy",
      input_cost_per_million: 2,
      output_cost_per_million: 10,
      context_window: 32768,
      max_output_tokens: 32768,
      supports_vision: true,
      supports_tools: true,
      supports_prompt_caching: false,
      supports_reasoning: false,
      supports_computer_use: false,
      tier: "mid",
      capabilities: [
        "code",
        "general",
        "vision"
      ]
    }
  ]
};

// src/index.ts
var PROVIDERS = {
  anthropic: anthropic_default,
  openai: openai_default,
  google: google_default,
  xai: xai_default
};
function getProviderModels(provider) {
  const data = PROVIDERS[provider];
  return data.models.map((model) => ({ ...model, provider }));
}
function getModel(provider, modelId) {
  const models = getProviderModels(provider);
  return models.find((m) => m.id === modelId) ?? models.find((m) => m.aliases.includes(modelId));
}
function getAllModels() {
  return Object.keys(PROVIDERS).flatMap(getProviderModels);
}
function getAllProviders() {
  return Object.keys(PROVIDERS);
}
function getProviderMeta(provider) {
  const { provider: p, last_updated, last_verified, source } = PROVIDERS[provider];
  return { provider: p, last_updated, last_verified, source };
}
function getPricingAgeInDays(provider) {
  const { last_verified } = PROVIDERS[provider];
  const ms = Date.now() - new Date(last_verified).getTime();
  return Math.floor(ms / (1e3 * 60 * 60 * 24));
}
function calculateCost(params) {
  const {
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens = 0,
    useBatch = false
  } = params;
  const isLongContext = params.isLongContext ?? inputTokens > 2e5;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  let inputRatePerMillion;
  if (useBatch && model.batch_input_cost_per_million !== void 0) {
    inputRatePerMillion = model.batch_input_cost_per_million;
  } else if (isLongContext && model.input_cost_above_200k_per_million !== void 0) {
    inputRatePerMillion = model.input_cost_above_200k_per_million;
  } else {
    inputRatePerMillion = model.input_cost_per_million;
  }
  let outputRatePerMillion;
  if (useBatch && model.batch_output_cost_per_million !== void 0) {
    outputRatePerMillion = model.batch_output_cost_per_million;
  } else if (isLongContext && model.output_cost_above_200k_per_million !== void 0) {
    outputRatePerMillion = model.output_cost_above_200k_per_million;
  } else {
    outputRatePerMillion = model.output_cost_per_million;
  }
  const inputCost = uncachedInputTokens / 1e6 * inputRatePerMillion;
  const cachedCost = cachedInputTokens > 0 && model.cache_read_input_cost_per_million !== void 0 ? cachedInputTokens / 1e6 * model.cache_read_input_cost_per_million : 0;
  const outputCost = outputTokens / 1e6 * outputRatePerMillion;
  return inputCost + cachedCost + outputCost;
}
export {
  calculateCost,
  getAllModels,
  getAllProviders,
  getModel,
  getPricingAgeInDays,
  getProviderMeta,
  getProviderModels
};
