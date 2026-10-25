/**
 * Shared pipeline utilities for Vercel API routes.
 * Ported from the Base44 runtime-injected pipeline.ts.
 */

// ─── LLM Error ────────────────────────────────────────────────────────────────

export class LLMError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'LLMError';
    this.code = code || 'llm_error';
    this.status = status || 502;
  }
}

// ─── Key Pool ─────────────────────────────────────────────────────────────────
//
// Round-robins across a list of API keys for a single provider.
// On 429 or timeout the caller marks the key as failed; the pool then skips it
// (up to 3 consecutive failures) and hands out the next available key.
//
// Usage:
//   const pool = new KeyPool(['key1', 'key2', 'key3']);
//   const key  = pool.next();       // advances the cursor each call
//   pool.markFailed(key);           // deprioritises this key
//   pool.markSuccess(key);          // resets its failure counter
//
export class KeyPool {
  constructor(keys = []) {
    this._keys = keys.filter(Boolean);
    this._index = 0;
    this._failures = {};
  }

  get size() {
    return this._keys.length;
  }

  next() {
    if (!this._keys.length) return null;
    const total = this._keys.length;
    for (let i = 0; i < total; i++) {
      const key = this._keys[this._index % total];
      this._index = (this._index + 1) % total;
      if ((this._failures[key] || 0) < 3) return key;
    }
    // All keys have recent failures — reset counters and return first key anyway.
    this._failures = {};
    return this._keys[0];
  }

  markFailed(key) {
    this._failures[key] = (this._failures[key] || 0) + 1;
  }

  markSuccess(key) {
    this._failures[key] = 0;
  }
}

// ─── Retry / timeout constants ────────────────────────────────────────────────
//
// 3 attempts, 150 s abort each.
// Total worst-case: 150 s + 3 s + 150 s + 6 s + 150 s = ~459 s.
// Vercel Pro supports up to 800 s. On the Hobby plan (300 s limit) set
// MAX_ATTEMPTS=2 and ATTEMPT_TIMEOUT_MS=90_000.
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 150_000;
const BACKOFF_MS = [3000, 6000]; // wait between attempt 1→2 and 2→3

// ─── Low-level HTTP helper ────────────────────────────────────────────────────

async function postOnce(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Provider-specific HTTP callers ──────────────────────────────────────────
//
// Each returns { text, inputTokens, outputTokens } or throws LLMError.
// They are intentionally thin — no retry logic here; that lives in pooledComplete.

/** Google AI Studio — generateContent endpoint */
async function callGoogle({ key, model, system, user, maxTokens }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const response = await postOnce(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens || 4000, temperature: 1 },
    }),
  });
  if (response.status === 429 || response.status >= 500) {
    throw new LLMError(`Google upstream unavailable (${response.status})`, 'upstream_unavailable', 503);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new LLMError(`Google request rejected (${response.status}): ${detail}`, 'request_rejected', 400);
  }
  const payload = await response.json();
  const candidate = (payload.candidates || [])[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  const usage = payload.usageMetadata || {};
  return {
    text,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

/** OpenRouter — OpenAI-compatible chat completions endpoint.
 *  Can route to virtually any model (Gemini, Claude, GPT, Llama, etc.) */
async function callOpenRouter({ key, model, system, user, maxTokens }) {
  const response = await postOnce('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
      'http-referer': 'https://toned.ai',
      'x-title': 'Toned AI Humanizer',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens || 4000,
      temperature: 1,
    }),
  });
  if (response.status === 429 || response.status >= 500) {
    throw new LLMError(`OpenRouter upstream unavailable (${response.status})`, 'upstream_unavailable', 503);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new LLMError(`OpenRouter request rejected (${response.status}): ${detail}`, 'request_rejected', 400);
  }
  const payload = await response.json();
  const text = (payload.choices?.[0]?.message?.content || '').trim();
  const usage = payload.usage || {};
  return {
    text,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  };
}

/** SambaNova — OpenAI-compatible endpoint, optimised for high-throughput fast inference */
async function callSambaNova({ key, model, system, user, maxTokens }) {
  const response = await postOnce('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens || 4000,
      temperature: 1,
    }),
  });
  if (response.status === 429 || response.status >= 500) {
    throw new LLMError(`SambaNova upstream unavailable (${response.status})`, 'upstream_unavailable', 503);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new LLMError(`SambaNova request rejected (${response.status}): ${detail}`, 'request_rejected', 400);
  }
  const payload = await response.json();
  const text = (payload.choices?.[0]?.message?.content || '').trim();
  const usage = payload.usage || {};
  return {
    text,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  };
}

/** Cloudflare Workers AI — REST endpoint.
 *  model must be the full CF model path e.g. "@cf/meta/llama-3.1-8b-instruct" */
async function callCloudflare({ key, model, system, user, maxTokens, accountId }) {
  if (!accountId) {
    throw new LLMError('CLOUDFLARE_ACCOUNT_ID is not configured.', 'no_account_id', 500);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const response = await postOnce(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens || 4000,
    }),
  });
  if (response.status === 429 || response.status >= 500) {
    throw new LLMError(`Cloudflare upstream unavailable (${response.status})`, 'upstream_unavailable', 503);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new LLMError(`Cloudflare request rejected (${response.status}): ${detail}`, 'request_rejected', 400);
  }
  const payload = await response.json();
  const text = (payload.result?.response || '').trim();
  // Cloudflare doesn't return token counts on all models
  return { text, inputTokens: 0, outputTokens: 0 };
}

// ─── Pool-aware multi-provider caller ────────────────────────────────────────
//
// Tries providers in priority order, rotating keys within each pool on failure.
// A 429 or timeout marks the current key as failed and rotates to the next key
// (or next provider) before the next attempt — no manual intervention needed.
//
// Arguments:
//   pools      – { google: KeyPool, openrouter: KeyPool, sambanova: KeyPool, cloudflare: KeyPool }
//   models     – { google: { fast, quality }, openrouter: { fast, quality }, … }
//   accountIds – { cloudflare: '<CF account id>' }
//   tier       – 'fast' | 'quality'
//
// Provider priority:
//   fast    → SambaNova (speed) → Google → OpenRouter → Cloudflare
//   quality → Google → OpenRouter → SambaNova → Cloudflare
//
export async function pooledComplete({
  pools,
  models,
  accountIds = {},
  tier = 'fast',
  system,
  user,
  maxTokens,
}) {
  const ORDER =
    tier === 'fast'
      ? ['sambanova', 'google', 'openrouter', 'cloudflare']
      : ['google', 'openrouter', 'sambanova', 'cloudflare'];

  const available = ORDER.filter((p) => pools[p] && pools[p].size > 0);

  if (!available.length) {
    throw new LLMError('No API keys configured for any provider.', 'no_keys', 500);
  }

  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Spread attempts across providers so a single slow provider doesn't block all retries
    const provider = available[attempt % available.length];
    const pool = pools[provider];
    const model = models[provider]?.[tier];

    if (!model) {
      lastError = new LLMError(`No model configured for ${provider}/${tier}`, 'no_model', 500);
      continue;
    }

    const key = pool.next();
    if (!key) continue;

    try {
      const started = Date.now();
      let result;

      if (provider === 'google') {
        result = await callGoogle({ key, model, system, user, maxTokens });
      } else if (provider === 'openrouter') {
        result = await callOpenRouter({ key, model, system, user, maxTokens });
      } else if (provider === 'sambanova') {
        result = await callSambaNova({ key, model, system, user, maxTokens });
      } else if (provider === 'cloudflare') {
        result = await callCloudflare({
          key,
          model,
          system,
          user,
          maxTokens,
          accountId: accountIds.cloudflare,
        });
      }

      pool.markSuccess(key);
      return { ...result, model: `${provider}/${model}`, latencyMs: Date.now() - started };
    } catch (err) {
      pool.markFailed(key);
      // Hard rejection (bad prompt / invalid key) — record and move on, no wait
      if (err instanceof LLMError && err.code === 'request_rejected') {
        lastError = err;
        continue;
      }
      // Rate limit / timeout — wait before the next attempt
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) =>
          setTimeout(r, BACKOFF_MS[attempt] ?? BACKOFF_MS.at(-1)),
        );
      }
    }
  }

  throw lastError instanceof LLMError
    ? lastError
    : new LLMError('All providers failed to respond in time.', 'timeout', 504);
}

// ─── Legacy single-key callers (backward compat) ──────────────────────────────
//
// run-stage.js now wires everything through pooledComplete.
// These stubs remain so any other route that imports geminiComplete won't break.

export async function geminiComplete({ key, model, system, user, maxTokens }) {
  const started = Date.now();
  const result = await callGoogle({ key, model, system, user, maxTokens });
  return { ...result, model, latencyMs: Date.now() - started };
}

export const anthropicComplete = geminiComplete;

// ─── JSON stage runner ────────────────────────────────────────────────────────

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

// Pool-aware JSON runner used by run-stage.js
export async function runJsonStagePooled({ pools, models, accountIds, tier, system, user, maxTokens }) {
  const result = await pooledComplete({ pools, models, accountIds, tier, system, user, maxTokens });
  let data;
  try {
    data = extractJson(result.text);
  } catch {
    throw new LLMError(
      `Model returned invalid JSON: ${result.text.slice(0, 200)}`,
      'invalid_json',
      502,
    );
  }
  return {
    data,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    model: result.model,
  };
}

// Legacy single-key JSON runner (kept for backward compat)
export async function runJsonStage({ key, model, system, user, maxTokens }) {
  const result = await geminiComplete({ key, model, system, user, maxTokens });
  let data;
  try {
    data = extractJson(result.text);
  } catch {
    throw new LLMError(
      `Model returned invalid JSON: ${result.text.slice(0, 200)}`,
      'invalid_json',
      502,
    );
  }
  return {
    data,
    usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    model: result.model,
  };
}

// ─── Text utilities ───────────────────────────────────────────────────────────

export function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function wrapUserText(text) {
  return `<text>\n${text}\n</text>`;
}

export function splitChunks(text, chunkWords = 800) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = [];
  let currentWords = 0;

  for (const para of paragraphs) {
    const paraWords = wordCount(para);
    if (currentWords + paraWords > chunkWords && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [para];
      currentWords = paraWords;
    } else {
      current.push(para);
      currentWords += paraWords;
    }
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));

  return chunks.map((chunkText, index) => ({
    index,
    text: chunkText,
    words: wordCount(chunkText),
  }));
}

// ─── Cost estimation ──────────────────────────────────────────────────────────

const PRICING = {
  fast: { input: 1, output: 5 },    // per 1M tokens, USD
  quality: { input: 2, output: 10 },
};

export function estimateCost(usage, tier) {
  const p = PRICING[tier] || PRICING.fast;
  const inputCost = ((usage?.inputTokens || 0) / 1_000_000) * p.input;
  const outputCost = ((usage?.outputTokens || 0) / 1_000_000) * p.output;
  return Math.round((inputCost + outputCost) * 1e6) / 1e6;
}

// ─── Intent / safety check ────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bacademic\s*(fraud|dishonesty|cheat)\b/i,
  /\bbypass\s*(ai|plagiarism)\s*(detector|check)\b/i,
  /\bcheat\s*(on\s*(my\s*)?)?(assignment|essay|exam|test|homework)\b/i,
  /\bsubmit\s*(as\s*(my\s*)?own|without\s*attribution)\b/i,
  /\bdeceive\s*(my\s*)?(professor|teacher|instructor|grader)\b/i,
];

export function intentCheck(purpose, customStyle) {
  const combined = `${purpose || ''} ${customStyle || ''}`.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        blocked: true,
        reason:
          'This request appears to involve academic dishonesty or deliberate deception. Humanizer cannot assist with that.',
      };
    }
  }
  return { blocked: false };
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

export function auditProblems(audit) {
  if (!audit) return [];
  const flags = [];
  for (const item of audit.items || []) {
    if (item.status === 'altered' || item.status === 'missing') {
      flags.push({ kind: item.kind, value: item.value, status: item.status, note: item.note });
    }
  }
  for (const item of audit.certainty || []) {
    if (item.status !== 'none') {
      flags.push({ kind: 'certainty', value: item.marker, status: item.status, note: item.note });
    }
  }
  for (const item of audit.format_violations || []) {
    flags.push({ kind: 'format', value: item.rule, status: 'violated', note: item.note });
  }
  return flags;
}

export function summarizeAudit(audit) {
  if (!audit) return {};
  const items = audit.items || [];
  return {
    preserved: items.filter((i) => i.status === 'preserved').length,
    altered: items.filter((i) => i.status === 'altered').length,
    missing: items.filter((i) => i.status === 'missing').length,
    added: items.filter((i) => i.status === 'added').length,
    format_violations: (audit.format_violations || []).length,
    certainty_shifts: (audit.certainty || []).filter((i) => i.status !== 'none').length,
  };
}

// ─── Deterministic checks ─────────────────────────────────────────────────────

export function deterministicChecks(extraction, rewritten) {
  if (!extraction || !rewritten) return { passed: [], failed: [] };
  const passed = [];
  const failed = [];
  const text = rewritten.toLowerCase();

  for (const num of extraction.numbers || []) {
    const val = String(num.value || '').trim();
    if (!val) continue;
    if (text.includes(val.toLowerCase())) {
      passed.push({ kind: 'number', value: val });
    } else {
      failed.push({ kind: 'number', value: val, note: 'Not found verbatim in rewrite' });
    }
  }

  for (const quote of extraction.quotations || []) {
    const snippet = String(quote.text || '').slice(0, 40).toLowerCase();
    if (!snippet) continue;
    if (text.includes(snippet)) {
      passed.push({ kind: 'quotation', value: snippet });
    } else {
      failed.push({ kind: 'quotation', value: snippet, note: 'Quotation may have been altered' });
    }
  }

  return { passed, failed };
}
