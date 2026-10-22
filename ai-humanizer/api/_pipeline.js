/**
 * Shared pipeline utilities for Vercel API routes.
 * Ported from the Base44 runtime-injected pipeline.ts.
 */

// ─── LLM ─────────────────────────────────────────────────────────────────────

export class LLMError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'LLMError';
    this.code = code || 'llm_error';
    this.status = status || 502;
  }
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
        lastError = new LLMError(
          `Upstream model unavailable (${response.status})`,
          'upstream_unavailable',
          503,
        );
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      if (!response.ok) {
        const detail = await response.text();
        throw new LLMError(
          `Model request rejected (${response.status}): ${detail}`,
          'request_rejected',
          400,
        );
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof LLMError && error.code === 'request_rejected') throw error;
      lastError = error;
      if (attempt < BACKOFF_MS.length - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
  }
  throw lastError instanceof LLMError
    ? lastError
    : new LLMError('The model did not respond in time.', 'timeout', 504);
}

/**
 * Google Gemini via the v1beta generateContent endpoint.
 * System prompt is passed as `system_instruction`, user text as a single
 * `user` turn. Cache param is accepted but silently ignored (Gemini handles
 * caching automatically for long prompts).
 */
export async function geminiComplete({ key, model, system, user, maxTokens }) {
  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: maxTokens || 4000,
      temperature: 1,
    },
  };
  const payload = await postWithRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const candidate = (payload.candidates || [])[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  const usage = payload.usageMetadata || {};
  return {
    text,
    model,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    latencyMs: Date.now() - started,
  };
}

// Keep the old name as an alias so run-stage.js requires no changes.
export const anthropicComplete = geminiComplete;

// ─── JSON stage runner ────────────────────────────────────────────────────────

function extractJson(text) {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

export async function runJsonStage({ key, model, system, user, maxTokens, cache }) {
  const result = await anthropicComplete({ key, model, system, user, maxTokens, cache });
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
  return { data, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens }, model: result.model };
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
  fast: { input: 1, output: 5 },      // per 1M tokens, USD
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
    // Check first 40 chars of quote
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
