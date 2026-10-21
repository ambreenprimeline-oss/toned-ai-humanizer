/**
 * LLM provider abstraction.
 *
 * Every pipeline stage talks to this interface only, so the vendor or model
 * can be swapped without touching pipeline code.
 *
 * complete({ system, user, tier, jsonSchema, maxTokens, cache })
 *   -> { text, model, provider, inputTokens, outputTokens, latencyMs, estimatedTokens }
 *
 * Two implementations:
 *  - anthropic: the Anthropic Messages API, used whenever ANTHROPIC_API_KEY is set.
 *  - platform:  the platform's built-in model integration, used only when no key
 *               is configured yet, so the product works before billing is wired up.
 */

export class LLMError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "LLMError";
    this.code = code || "llm_error";
    this.status = status || 502;
  }
}

export function estimateTokens(text) {
  return Math.ceil((String(text || "").length || 0) / 4);
}

const BACKOFF_MS = [1000, 4000, 10000];

async function postWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (response.status === 429 || response.status >= 500) {
        lastError = new LLMError(`Upstream model unavailable (${response.status})`, "upstream_unavailable", 503);
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        continue;
      }
      if (!response.ok) {
        const detail = await response.text();
        throw new LLMError(`Model request rejected (${response.status})`, "request_rejected", 400, detail);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof LLMError && error.code === "request_rejected") throw error;
      lastError = error;
      if (attempt < BACKOFF_MS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
      }
    }
  }
  throw lastError instanceof LLMError
    ? lastError
    : new LLMError("The model did not respond in time.", "timeout", 504);
}

async function anthropicComplete({ key, cfg, system, user, tier, maxTokens, cache }) {
  const model = tier === "quality" ? cfg.modelQuality : cfg.modelFast;
  const started = Date.now();
  const body = {
    model,
    max_tokens: maxTokens || (tier === "quality" ? 8000 : 4000),
    system: [
      {
        type: "text",
        text: system,
        ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
      },
    ],
    messages: [{ role: "user", content: user }],
  };
  const payload = await postWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const text = (payload.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const usage = payload.usage || {};
  return {
    text,
    model: payload.model || model,
    provider: "anthropic",
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    latencyMs: Date.now() - started,
    estimatedTokens: false,
  };
}

async function platformComplete(base44, cfg, { system, user, tier, jsonSchema }) {
  const started = Date.now();
  const model = tier === "quality" ? cfg.platformModels.quality : cfg.platformModels.fast;
  const args = { prompt: `${system}\n\n${user}`, model };
  if (jsonSchema) args.response_json_schema = jsonSchema;
  const out = await base44.asServiceRole.integrations.Core.InvokeLLM(args);
  const text = typeof out === "string" ? out : JSON.stringify(out);
  return {
    text,
    model,
    provider: "platform",
    inputTokens: estimateTokens(system + user),
    outputTokens: estimateTokens(text),
    latencyMs: Date.now() - started,
    estimatedTokens: true,
  };
}

/**
 * Returns the active provider. Anthropic is used as soon as a key is present.
 */
export function createProvider(base44, cfg, anthropicKey) {
  const key = String(anthropicKey || "").trim();
  if (key) {
    return {
      id: "anthropic",
      complete: (request) => anthropicComplete({ ...request, key, cfg }),
    };
  }
  return {
    id: "platform",
    complete: (request) => platformComplete(base44, cfg, request),
  };
}