/**
 * Vercel serverless function — replaces the Base44 runRewriteStage function.
 * POST /api/run-stage
 * Body: { job: <RewriteJob object>, stage: string, chunk_index?: number }
 * Returns: updated job fields + stage metadata
 *
 * The job object is passed in from the client (stored in localStorage) and
 * the patched fields are returned for the client to merge back into its store.
 */

import {
  anthropicComplete,
  auditProblems,
  deterministicChecks,
  estimateCost,
  intentCheck,
  runJsonStage,
  splitChunks,
  summarizeAudit,
  wordCount,
  wrapUserText,
} from './_pipeline.js';

import {
  AI_PATTERN_CATALOG,
  PROMPTS,
  REWRITE_SYSTEM,
  SCHEMAS,
  STYLE_MODULES,
} from './_prompts.js';

const COST_GUARD =
  'Cost guard: this job passed the per-job token ceiling and was stopped. Shorten the input or raise MAX_JOB_TOKENS in your environment.';

function round6(v) {
  return Math.round((Number(v) || 0) * 1e6) / 1e6;
}

function mergeUsage(job, usage, tier) {
  return {
    input_tokens: (job.input_tokens || 0) + (usage?.inputTokens || 0),
    output_tokens: (job.output_tokens || 0) + (usage?.outputTokens || 0),
    cost_estimate: round6((job.cost_estimate || 0) + estimateCost(usage, tier)),
  };
}

function appendNote(existing, line) {
  return [existing, line].filter(Boolean).join('\n');
}

function constraintsLine(job) {
  return `Formatting constraints - preserve headings: ${
    job.preserve_headings === false ? 'no' : 'yes'
  }; preserve lists: ${job.preserve_lists === false ? 'no' : 'yes'}; length target: ${
    job.length_target || 'same'
  }.`;
}

function extractionDigest(extraction) {
  return JSON.stringify({
    claims: (extraction?.claims || []).map((c) => c.text).slice(0, 60),
    numbers: (extraction?.numbers || []).map((n) => n.value).slice(0, 80),
    entities: (extraction?.named_entities || []).map((e) => e.name).slice(0, 80),
    citations: (extraction?.citations || []).map((c) => c.text).slice(0, 40),
    quotations: (extraction?.quotations || []).map((q) => q.text).slice(0, 40),
    hedges: (extraction?.hedge_markers || []).map((h) => h.text).slice(0, 60),
  });
}

function lastWords(text, count) {
  const words = String(text || '').trim().split(/\s+/);
  return words.slice(Math.max(0, words.length - count)).join(' ');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GOOGLE_API_KEY is not configured. Add it to your Vercel environment variables.',
    });
  }

  const modelFast = process.env.MODEL_FAST || 'gemini-2.0-flash';
  const modelQuality = process.env.MODEL_QUALITY || 'gemini-2.5-pro';
  const maxInputChars = Number(process.env.MAX_INPUT_CHARS) || 20000;
  const maxJobTokens = Number(process.env.MAX_JOB_TOKENS) || 120000;
  const chunkWords = 800;
  const maxRepairLoops = 2;
  const promptVersion = 'humanizer/1.0.0';

  const llm = {
    fast: (opts) => {
      if (opts.json) {
        return runJsonStage({ key: apiKey, model: modelFast, ...opts });
      }
      return anthropicComplete({ key: apiKey, model: modelFast, ...opts });
    },
    quality: (opts) => {
      if (opts.json) {
        return runJsonStage({ key: apiKey, model: modelQuality, ...opts });
      }
      return anthropicComplete({ key: apiKey, model: modelQuality, ...opts });
    },
  };

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { job: rawJob, stage, chunk_index: chunkIndex = 0 } = body || {};

  if (!rawJob || !stage) {
    return res.status(400).json({ error: 'job and stage are required' });
  }

  // Work on a mutable copy; we return only the patched fields
  const job = { ...rawJob };

  // Cost guard
  if ((job.input_tokens || 0) + (job.output_tokens || 0) > maxJobTokens) {
    return res.status(200).json({
      stage,
      error: COST_GUARD,
      patch: { status: 'failed', error: COST_GUARD },
    });
  }

  try {
    // ── EXTRACT ────────────────────────────────────────────────────────────────
    if (stage === 'extract') {
      if (job.extraction && Array.isArray(job.chunks) && job.chunks.length) {
        return res.json({ stage, cached: true, chunk_count: job.chunks.length, progress: job.progress || 15, patch: {} });
      }

      const source = String(job.source_text || '').trim();
      if (!source) {
        return res.json({ stage, error: 'There is no text to rewrite.', patch: { status: 'failed', error: 'There is no text to rewrite.' } });
      }
      if (source.length > maxInputChars) {
        const error = `This document is ${source.length.toLocaleString()} characters; the limit is ${maxInputChars.toLocaleString()}.`;
        return res.json({ stage, error, patch: { status: 'failed', error } });
      }

      const refusal = intentCheck(job.purpose, job.custom_style);
      if (refusal.blocked) {
        return res.json({ stage, refused: true, reason: refusal.reason, patch: { status: 'refused', stage, progress: 0, error: refusal.reason } });
      }

      const chunks = splitChunks(source, chunkWords);
      const result = await llm.fast({
        json: true,
        system: PROMPTS.extract.system,
        user: `${wrapUserText(source)}\n\nReturn the extraction JSON for the text above.`,
        maxTokens: PROMPTS.extract.maxTokens,
        cache: true,
      });

      const patch = {
        ...mergeUsage(job, result.usage, 'fast'),
        extraction: result.data,
        chunks: chunks.map((c) => ({ index: c.index, text: '', source_words: c.words })),
        source_words: wordCount(source),
        status: 'running',
        stage,
        progress: 15,
        prompt_version: promptVersion,
        model_fast: modelFast,
        model_quality: modelQuality,
        error: '',
      };
      return res.json({ stage, chunk_count: chunks.length, progress: 15, patch });
    }

    // ── DIAGNOSE ───────────────────────────────────────────────────────────────
    if (stage === 'diagnose') {
      if (job.diagnosis && job.rewrite_plan) {
        return res.json({ stage, cached: true, progress: job.progress || 25, patch: {} });
      }
      const result = await llm.fast({
        json: true,
        system: `${PROMPTS.diagnose.system}\n\nAI-PATTERN CATALOG:\n${AI_PATTERN_CATALOG}`,
        user: `Style requested: ${job.style}${job.custom_style ? ` (${job.custom_style})` : ''}\n${wrapUserText(job.source_text)}`,
        maxTokens: PROMPTS.diagnose.maxTokens,
        cache: true,
      });
      const patch = {
        ...mergeUsage(job, result.usage, 'fast'),
        diagnosis: result.data,
        rewrite_plan: result.data.plan || {},
        stage,
        progress: 25,
        error: '',
      };
      return res.json({ stage, progress: 25, patch });
    }

    // ── REWRITE ────────────────────────────────────────────────────────────────
    if (stage === 'rewrite') {
      const stored = (job.chunks || []).map((c) => ({ ...c }));
      if (!stored.length) {
        return res.json({ stage, error: 'Run the extract stage first.', patch: {} });
      }
      const target = stored[chunkIndex];
      if (!target) {
        return res.json({ stage, error: 'That section does not exist.', patch: {} });
      }
      if (target.text) {
        const done = stored.filter((c) => c.text).length;
        return res.json({ stage, chunk_index: chunkIndex, cached: true, done, chunk_count: stored.length, progress: job.progress || 40, patch: {} });
      }

      const sourceChunks = splitChunks(String(job.source_text || ''), chunkWords);
      const sourceChunk = sourceChunks[chunkIndex];
      if (!sourceChunk) {
        return res.json({ stage, error: 'That section does not exist.', patch: {} });
      }

      const context = stored
        .slice(Math.max(0, chunkIndex - 2), chunkIndex)
        .filter((c) => c.text)
        .map((c) => lastWords(c.text, 80));

      const style = STYLE_MODULES[job.style] || STYLE_MODULES.professional_researcher;
      const customStyle =
        job.style === 'custom' && job.custom_style
          ? `\nAuthor's own style instruction: ${job.custom_style}`
          : '';

      const userPrompt = [
        `STYLE MODULE (${job.style}):\n${style}${customStyle}`,
        constraintsLine(job),
        `REWRITE PLAN (diagnostic stage):\n${JSON.stringify(job.rewrite_plan || {})}`,
        `MUST SURVIVE UNCHANGED (extracted from the source):\n${extractionDigest(job.extraction)}`,
        context.length
          ? `PRECEDING SECTIONS (do not repeat, only continue smoothly):\n${context.join('\n---\n')}`
          : '',
        `SECTION ${chunkIndex + 1} OF ${stored.length}: rewrite the text below, paragraph by paragraph.`,
        wrapUserText(sourceChunk.text),
      ]
        .filter(Boolean)
        .join('\n\n');

      const result = await anthropicComplete({
        key: apiKey,
        model: modelQuality,
        system: `${REWRITE_SYSTEM}\n\nAI-PATTERN CATALOG (reference):\n${AI_PATTERN_CATALOG}`,
        user: userPrompt,
        maxTokens: 8000,
        cache: true,
      });

      const text = String(result.text || '').trim();
      if (!text) {
        return res.json({ stage, error: 'The rewrite engine returned an empty section.', patch: { status: 'failed', error: 'The rewrite engine returned an empty section.' } });
      }

      target.text = text;
      stored[chunkIndex] = target;
      const done = stored.filter((c) => c.text).length;
      const progress = 25 + Math.round((done / stored.length) * 45);
      const patch = {
        ...mergeUsage(job, { inputTokens: result.inputTokens, outputTokens: result.outputTokens }, 'quality'),
        chunks: stored,
        rewritten_text: stored.map((c) => c.text).filter(Boolean).join('\n\n'),
        stage,
        progress,
      };
      return res.json({ stage, chunk_index: chunkIndex, done, chunk_count: stored.length, progress, patch });
    }

    // ── ASSEMBLE ───────────────────────────────────────────────────────────────
    if (stage === 'assemble') {
      if (job.consistency_done) {
        return res.json({ stage, cached: true, progress: job.progress || 75, patch: {} });
      }
      const stitched = (job.chunks || []).map((c) => c.text).filter(Boolean).join('\n\n');
      if (!stitched) {
        return res.json({ stage, error: 'There are no rewritten sections to stitch yet.', patch: {} });
      }

      let text = stitched;
      let edits = [];
      let usage = null;
      if ((job.chunks || []).length > 1) {
        const result = await llm.quality({
          json: true,
          system: PROMPTS.consistency.system,
          user: [
            constraintsLine(job),
            `TERMS THAT MUST READ IDENTICALLY THROUGHOUT: ${JSON.stringify(
              (job.extraction?.named_entities || []).map((e) => e.name).slice(0, 60),
            )}`,
            wrapUserText(stitched),
          ].join('\n\n'),
          maxTokens: PROMPTS.consistency.maxTokens,
          cache: true,
        });
        text = String(result.data.text || stitched).trim();
        edits = result.data.edits || [];
        usage = result.usage;
      }

      const patch = {
        ...(usage ? mergeUsage(job, usage, 'quality') : {}),
        rewritten_text: text,
        consistency_done: true,
        consistency_edits: edits,
        notes: edits.length
          ? appendNote(job.notes, `Consistency pass touched ${edits.length} seam(s): ${edits.join('; ')}`)
          : job.notes,
        stage,
        progress: 75,
      };
      return res.json({ stage, progress: 75, patch });
    }

    // ── AUDIT ──────────────────────────────────────────────────────────────────
    if (stage === 'audit') {
      const rewritten = String(job.rewritten_text || '');
      if (!rewritten) {
        return res.json({ stage, error: 'There is nothing to audit yet.', patch: {} });
      }
      const deterministic = deterministicChecks(job.extraction, rewritten);
      const result = await llm.fast({
        json: true,
        system: PROMPTS.audit.system,
        user: [
          `EXTRACTION FROM THE ORIGINAL (ground truth):\n${JSON.stringify(job.extraction || {})}`,
          `ALREADY CONFIRMED BY THE DETERMINISTIC PASS IN CODE:\n${JSON.stringify(deterministic)}`,
          constraintsLine(job),
          wrapUserText(rewritten),
        ].join('\n\n'),
        maxTokens: PROMPTS.audit.maxTokens,
        cache: true,
      });
      const audit = { ...result.data, deterministic };
      const flags = auditProblems(audit);
      const patch = {
        ...mergeUsage(job, result.usage, 'fast'),
        audit,
        unresolved_flags: flags,
        stage,
        progress: 85,
      };
      return res.json({
        stage,
        progress: 85,
        has_problems: flags.length > 0,
        flag_count: flags.length,
        counts: summarizeAudit(audit),
        patch,
      });
    }

    // ── REPAIR ─────────────────────────────────────────────────────────────────
    if (stage === 'repair') {
      const flags = auditProblems(job.audit);
      if (!flags.length) {
        return res.json({ stage, skipped: true, reason: 'Nothing to repair.', progress: 88, patch: {} });
      }
      if ((job.repair_loops || 0) >= maxRepairLoops) {
        return res.json({ stage, skipped: true, reason: 'Repair loop limit reached.', progress: 90, patch: {} });
      }
      const result = await llm.quality({
        json: true,
        system: PROMPTS.repair.system,
        user: [
          `FLAGGED ITEMS - FIX ONLY THESE:\n${JSON.stringify(flags)}`,
          `FULL EXTRACTION FROM THE ORIGINAL (authoritative values):\n${JSON.stringify(job.extraction || {})}`,
          constraintsLine(job),
          wrapUserText(String(job.rewritten_text || '')),
        ].join('\n\n'),
        maxTokens: PROMPTS.repair.maxTokens,
        cache: true,
      });
      const fixes = result.data.fixes || [];
      const summary = fixes.length
        ? `Repair pass ${(job.repair_loops || 0) + 1}: ${fixes.map((f) => `${f.item} - ${f.action}`).join('; ')}`
        : `Repair pass ${(job.repair_loops || 0) + 1}: the rewriter left the text unchanged.`;
      const patch = {
        ...mergeUsage(job, result.usage, 'quality'),
        rewritten_text: String(result.data.text || job.rewritten_text || '').trim(),
        repair_loops: (job.repair_loops || 0) + 1,
        notes: appendNote(job.notes, summary),
        stage,
        progress: 88,
      };
      return res.json({ stage, repaired: true, repair_loops: patch.repair_loops, progress: 88, patch });
    }

    // ── FINALIZE ───────────────────────────────────────────────────────────────
    if (stage === 'finalize') {
      const finalText = String(job.rewritten_text || '').trim();
      if (!finalText) {
        return res.json({ stage, error: 'The rewrite did not produce any text.', patch: {} });
      }
      const flags = auditProblems(job.audit);
      const counts = summarizeAudit(job.audit);
      const status = flags.length ? 'needs_review' : 'completed';

      const notesLines = [];
      const diagnosis = job.diagnosis || {};
      const plan = job.rewrite_plan || {};
      if (diagnosis.purpose_guess) notesLines.push(`Purpose (inferred): ${diagnosis.purpose_guess}`);
      if (diagnosis.audience_guess) notesLines.push(`Audience (inferred): ${diagnosis.audience_guess}`);
      if (plan.register) notesLines.push(`Register: ${plan.register}`);
      if (plan.target_sentence_length_distribution) {
        notesLines.push(`Rhythm target: ${plan.target_sentence_length_distribution}`);
      }
      if (plan.transition_policy) notesLines.push(`Transitions: ${plan.transition_policy}`);
      if ((plan.structural_changes || []).length) {
        notesLines.push(`Structural moves: ${plan.structural_changes.join('; ')}`);
      }
      if ((diagnosis.ambiguous_sentences || []).length) {
        notesLines.push(
          `Ambiguous in the original, left as written: ${diagnosis.ambiguous_sentences
            .map((s) => s.sentence)
            .slice(0, 3)
            .join(' / ')}`,
        );
      }
      if (flags.length) {
        notesLines.push(
          `Audit found ${flags.length} unresolved flag(s) — review the Audit tab before publishing.`,
        );
      }

      const patch = {
        status,
        stage: 'finalize',
        progress: 100,
        final_text: finalText,
        result_words: wordCount(finalText),
        unresolved_flags: flags,
        notes: notesLines.length ? appendNote(job.notes, notesLines.join('\n')) : job.notes,
      };

      return res.json({ stage, status, unresolved_flags: flags, counts, patch });
    }

    return res.status(400).json({ error: `Unknown stage: ${stage}` });
  } catch (error) {
    console.error('run-stage error:', { stage, message: error.message });
    const message = error.message || 'The pipeline stage failed.';
    return res.status(error.status || 500).json({ error: message });
  }
}
