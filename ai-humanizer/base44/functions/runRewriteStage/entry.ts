import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { buildConfig } from '../../shared/config.ts';
import { createProvider } from '../../shared/llm.ts';
import {
  AI_PATTERN_CATALOG,
  PROMPTS,
  REWRITE_SYSTEM,
  SCHEMAS,
  STYLE_MODULES,
} from '../../shared/prompts.ts';
import {
  auditProblems,
  deterministicChecks,
  estimateCost,
  intentCheck,
  runJsonStage,
  splitChunks,
  summarizeAudit,
  wordCount,
  wrapUserText,
} from '../../shared/pipeline.ts';

const COST_GUARD =
  'Cost guard: this job passed the per-job token ceiling and was stopped before it could spend more. Shorten the input, or raise MAX_JOB_TOKENS.';

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

/** Logs carry metadata only - never any user text. */
function logStage(entry) {
  console.log(JSON.stringify({ event: 'pipeline_stage', ...entry }));
}

function lastWords(text, count) {
  const words = String(text || '').trim().split(/\s+/);
  return words.slice(Math.max(0, words.length - count)).join(' ');
}

function mergeUsage(job, usage, tier, cfg) {
  return {
    input_tokens: (job.input_tokens || 0) + (usage?.inputTokens || 0),
    output_tokens: (job.output_tokens || 0) + (usage?.outputTokens || 0),
    cost_estimate: round6((job.cost_estimate || 0) + estimateCost(usage, cfg, tier)),
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

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const jobId = typeof body.job_id === 'string' ? body.job_id : '';
    const stage = typeof body.stage === 'string' ? body.stage : '';
    const chunkIndex = Number.isInteger(body.chunk_index) ? body.chunk_index : 0;
    if (!jobId || !stage) {
      return Response.json({ error: 'job_id and stage are required' }, { status: 400 });
    }

    const job = await base44.entities.RewriteJob.get(jobId);
    if (!job || job.created_by_id !== user.id) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const cfg = buildConfig((name) => secrets.get(name));
    const provider = createProvider(base44, cfg, secrets.get('ANTHROPIC_API_KEY'));
    const patch = (data) => base44.entities.RewriteJob.update(jobId, data);

    if ((job.input_tokens || 0) + (job.output_tokens || 0) > cfg.maxJobTokens) {
      await patch({ status: 'failed', error: COST_GUARD });
      return Response.json({ stage, error: COST_GUARD });
    }

    if (stage === 'extract') {
      if (job.extraction && Array.isArray(job.chunks) && job.chunks.length) {
        return Response.json({
          stage,
          cached: true,
          chunk_count: job.chunks.length,
          progress: job.progress || 15,
        });
      }
      const source = String(job.source_text || '').trim();
      if (!source) {
        const error = 'There is no text to rewrite.';
        await patch({ status: 'failed', error });
        return Response.json({ stage, error });
      }
      if (source.length > cfg.maxInputChars) {
        const error = `This document is ${source.length.toLocaleString()} characters; the limit is ${cfg.maxInputChars.toLocaleString()}. Split it, or raise MAX_INPUT_CHARS.`;
        await patch({ status: 'failed', error });
        return Response.json({ stage, error });
      }
      const refusal = intentCheck(job.purpose, job.custom_style);
      if (refusal.blocked) {
        await patch({ status: 'refused', stage, progress: 0, error: refusal.reason });
        logStage({ job_id: jobId, stage, refused: true });
        return Response.json({ stage, refused: true, reason: refusal.reason });
      }

      const chunks = splitChunks(source, cfg.chunkWords);
      const result = await runJsonStage({
        provider,
        system: PROMPTS.extract.system,
        user: `${wrapUserText(source)}\n\nReturn the extraction JSON for the text above.`,
        schema: SCHEMAS.extraction,
        tier: 'fast',
        maxTokens: PROMPTS.extract.maxTokens,
        cache: true,
      });

      await patch({
        ...mergeUsage(job, result.usage, 'fast', cfg),
        extraction: result.data,
        chunks: chunks.map((chunk) => ({ index: chunk.index, text: '', source_words: chunk.words })),
        source_words: wordCount(source),
        status: 'running',
        stage,
        progress: 15,
        prompt_version: cfg.promptVersion,
        provider: provider.id,
        model_fast: cfg.modelFast,
        model_quality: cfg.modelQuality,
        error: '',
      });
      logStage({
        job_id: jobId,
        stage,
        provider: provider.id,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        chunks: chunks.length,
      });
      return Response.json({ stage, chunk_count: chunks.length, progress: 15 });
    }

    if (stage === 'diagnose') {
      if (job.diagnosis && job.rewrite_plan) {
        return Response.json({ stage, cached: true, progress: job.progress || 25 });
      }
      const result = await runJsonStage({
        provider,
        system: `${PROMPTS.diagnose.system}\n\nAI-PATTERN CATALOG:\n${AI_PATTERN_CATALOG}`,
        user: `Style requested: ${job.style}${
          job.custom_style ? ` (${job.custom_style})` : ''
        }\n${wrapUserText(job.source_text)}`,
        schema: SCHEMAS.diagnosis,
        tier: 'fast',
        maxTokens: PROMPTS.diagnose.maxTokens,
        cache: true,
      });
      await patch({
        ...mergeUsage(job, result.usage, 'fast', cfg),
        diagnosis: result.data,
        rewrite_plan: result.data.plan || {},
        stage,
        progress: 25,
        error: '',
      });
      logStage({
        job_id: jobId,
        stage,
        provider: provider.id,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        findings: (result.data.findings || []).length,
      });
      return Response.json({ stage, progress: 25 });
    }

    if (stage === 'rewrite') {
      // The stored chunks hold the ORIGINAL division of the document, so a
      // resumed job always rewrites the section it claims to rewrite.
      const stored = (job.chunks || []).map((chunk) => ({ ...chunk }));
      if (!stored.length) return Response.json({ stage, error: 'Run the extract stage first.' });
      const target = stored[chunkIndex];
      if (!target) return Response.json({ stage, error: 'That section does not exist.' });
      if (target.text) {
        return Response.json({
          stage,
          chunk_index: chunkIndex,
          cached: true,
          done: stored.filter((item) => item.text).length,
          chunk_count: stored.length,
          progress: job.progress || 40,
        });
      }

      const sourceChunk = splitChunks(String(job.source_text || ''), cfg.chunkWords)[chunkIndex];
      if (!sourceChunk) return Response.json({ stage, error: 'That section does not exist.' });

      const context = stored
        .slice(Math.max(0, chunkIndex - 2), chunkIndex)
        .filter((previous) => previous.text)
        .map((previous) => lastWords(previous.text, 80));
      const style = STYLE_MODULES[job.style] || STYLE_MODULES.professional_researcher;
      const customStyle =
        job.style === 'custom' && job.custom_style
          ? `\nAuthor's own style instruction: ${job.custom_style}`
          : '';

      const user = [
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

      const result = await provider.complete({
        system: `${REWRITE_SYSTEM}\n\nAI-PATTERN CATALOG (reference):\n${AI_PATTERN_CATALOG}`,
        user,
        tier: 'quality',
        maxTokens: 8000,
        cache: true,
      });

      const text = String(result.text || '').trim();
      if (!text) {
        const error = 'The rewrite engine returned an empty section.';
        await patch({ status: 'failed', error });
        return Response.json({ stage, error });
      }

      target.text = text;
      stored[chunkIndex] = target;
      const done = stored.filter((item) => item.text).length;
      const progress = 25 + Math.round((done / stored.length) * 45);
      await patch({
        ...mergeUsage(job, { inputTokens: result.inputTokens, outputTokens: result.outputTokens }, 'quality', cfg),
        chunks: stored,
        rewritten_text: stored.map((item) => item.text).filter(Boolean).join('\n\n'),
        stage,
        progress,
      });
      logStage({
        job_id: jobId,
        stage,
        chunk_index: chunkIndex,
        provider: provider.id,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      });
      return Response.json({
        stage,
        chunk_index: chunkIndex,
        done,
        chunk_count: stored.length,
        progress,
      });
    }

    if (stage === 'assemble') {
      if (job.consistency_done) {
        return Response.json({ stage, cached: true, progress: job.progress || 75 });
      }
      const stitched = (job.chunks || [])
        .map((chunk) => chunk.text)
        .filter(Boolean)
        .join('\n\n');
      if (!stitched) return Response.json({ stage, error: 'There are no rewritten sections to stitch yet.' });

      let text = stitched;
      let edits = [];
      let usage = null;
      if ((job.chunks || []).length > 1) {
        const result = await runJsonStage({
          provider,
          system: PROMPTS.consistency.system,
          user: [
            constraintsLine(job),
            `TERMS THAT MUST READ IDENTICALLY THROUGHOUT: ${JSON.stringify(
              (job.extraction?.named_entities || []).map((entity) => entity.name).slice(0, 60),
            )}`,
            wrapUserText(stitched),
          ].join('\n\n'),
          schema: SCHEMAS.consistency,
          tier: 'quality',
          maxTokens: PROMPTS.consistency.maxTokens,
          cache: true,
        });
        text = String(result.data.text || stitched).trim();
        edits = result.data.edits || [];
        usage = result.usage;
      }

      await patch({
        ...(usage ? mergeUsage(job, usage, 'quality', cfg) : {}),
        rewritten_text: text,
        consistency_done: true,
        consistency_edits: edits,
        notes: edits.length
          ? appendNote(job.notes, `Consistency pass touched ${edits.length} seam(s): ${edits.join('; ')}`)
          : job.notes,
        stage,
        progress: 75,
      });
      logStage({ job_id: jobId, stage, seams: edits.length });
      return Response.json({ stage, progress: 75 });
    }

    if (stage === 'audit') {
      const rewritten = String(job.rewritten_text || '');
      if (!rewritten) return Response.json({ stage, error: 'There is nothing to audit yet.' });
      const deterministic = deterministicChecks(job.extraction, rewritten);
      const result = await runJsonStage({
        provider,
        system: PROMPTS.audit.system,
        user: [
          `EXTRACTION FROM THE ORIGINAL (ground truth):\n${JSON.stringify(job.extraction || {})}`,
          `ALREADY CONFIRMED BY THE DETERMINISTIC PASS IN CODE:\n${JSON.stringify(deterministic)}`,
          constraintsLine(job),
          wrapUserText(rewritten),
        ].join('\n\n'),
        schema: SCHEMAS.audit,
        tier: 'fast',
        maxTokens: PROMPTS.audit.maxTokens,
        cache: true,
      });
      const audit = { ...result.data, deterministic };
      const flags = auditProblems(audit);
      await patch({
        ...mergeUsage(job, result.usage, 'fast', cfg),
        audit,
        unresolved_flags: flags,
        stage,
        progress: 85,
      });
      logStage({
        job_id: jobId,
        stage,
        provider: provider.id,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        flags: flags.length,
      });
      return Response.json({
        stage,
        progress: 85,
        has_problems: flags.length > 0,
        flag_count: flags.length,
        counts: summarizeAudit(audit),
      });
    }

    if (stage === 'repair') {
      const flags = auditProblems(job.audit);
      if (!flags.length) {
        return Response.json({ stage, skipped: true, reason: 'Nothing to repair.', progress: 88 });
      }
      if ((job.repair_loops || 0) >= cfg.maxRepairLoops) {
        return Response.json({ stage, skipped: true, reason: 'Repair loop limit reached.', progress: 90 });
      }
      const result = await runJsonStage({
        provider,
        system: PROMPTS.repair.system,
        user: [
          `FLAGGED ITEMS - FIX ONLY THESE:\n${JSON.stringify(flags)}`,
          `FULL EXTRACTION FROM THE ORIGINAL (authoritative values):\n${JSON.stringify(job.extraction || {})}`,
          constraintsLine(job),
          wrapUserText(String(job.rewritten_text || '')),
        ].join('\n\n'),
        schema: SCHEMAS.repair,
        tier: 'quality',
        maxTokens: PROMPTS.repair.maxTokens,
        cache: true,
      });
      const fixes = result.data.fixes || [];
      const summary = fixes.length
        ? `Repair pass ${(job.repair_loops || 0) + 1}: ${fixes
            .map((fix) => `${fix.item} - ${fix.action}`)
            .join('; ')}`
        : `Repair pass ${(job.repair_loops || 0) + 1}: the rewriter left the text unchanged.`;
      await patch({
        ...mergeUsage(job, result.usage, 'quality', cfg),
        rewritten_text: String(result.data.text || job.rewritten_text || '').trim(),
        repair_loops: (job.repair_loops || 0) + 1,
        notes: appendNote(job.notes, summary),
        stage,
        progress: 88,
      });
      logStage({ job_id: jobId, stage, provider: provider.id, model: result.model, fixes: fixes.length });
      return Response.json({
        stage,
        repaired: true,
        repair_loops: (job.repair_loops || 0) + 1,
        progress: 88,
      });
    }

    if (stage === 'finalize') {
      const refreshed = await base44.entities.RewriteJob.get(jobId);
      const finalText = String(refreshed.rewritten_text || '').trim();
      if (!finalText) return Response.json({ stage, error: 'The rewrite did not produce any text.' });
      const flags = auditProblems(refreshed.audit);
      const counts = summarizeAudit(refreshed.audit);
      const status = flags.length ? 'needs_review' : 'completed';

      const notesLines = [];
      const diagnosis = refreshed.diagnosis || {};
      const plan = refreshed.rewrite_plan || {};
      if (diagnosis.purpose_guess) notesLines.push(`Purpose (inferred from the text): ${diagnosis.purpose_guess}`);
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
            .map((item) => item.sentence)
            .join(' | ')}`,
        );
      }
      notesLines.push(
        `Audit: ${counts.preserved} preserved, ${counts.altered} altered, ${counts.missing} missing, ${counts.added} added.`,
      );
      if (refreshed.notes) notesLines.push(refreshed.notes);

      const unresolved = flags.slice(0, 40);
      await patch({
        final_text: finalText,
        result_words: wordCount(finalText),
        unresolved_flags: unresolved,
        notes: notesLines.join('\n'),
        status,
        stage,
        progress: 100,
        error: '',
      });
      logStage({
        job_id: jobId,
        stage,
        provider: provider.id,
        status,
        unresolved: unresolved.length,
        input_tokens: refreshed.input_tokens || 0,
        output_tokens: refreshed.output_tokens || 0,
      });

      const updated = await base44.entities.RewriteJob.get(jobId);
      return Response.json({
        stage,
        status,
        progress: 100,
        has_problems: unresolved.length > 0,
        unresolved_flags: unresolved,
        counts,
        job: updated,
      });
    }

    return Response.json({ stage, error: `Unknown stage: ${stage}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'The pipeline failed.' }, { status: 500 });
  }
}