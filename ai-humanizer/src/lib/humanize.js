import { base44 } from '@/api/base44Client';
import { countWords } from '@/lib/diff';

const MAX_REPAIR_LOOPS = 2;

export async function callStage(jobId, stage, extra = {}) {
  try {
    const response = await base44.functions.invoke('runRewriteStage', {
      job_id: jobId,
      stage,
      ...extra,
    });
    const data = (response && response.data) || {};
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) {
    // Prefer the pipeline's own message (usage limit, cost guard, refusal) over
    // the generic request failure the transport reports.
    const serverMessage = error?.response?.data?.error;
    throw new Error(serverMessage || error?.message || 'The rewrite could not be completed.');
  }
}

export function expiresAtFrom(retentionDays) {
  if (!retentionDays) return null;
  const date = new Date();
  date.setDate(date.getDate() + Number(retentionDays));
  return date.toISOString();
}

export function titleFrom(text, filename) {
  if (filename) return filename;
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (!firstLine) return 'Untitled rewrite';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export async function createJob({ text, style, customStyle, purpose, prefs, retentionDays, filename }) {
  return base44.entities.RewriteJob.create({
    title: titleFrom(text, filename),
    source_text: text,
    source_words: countWords(text),
    style,
    custom_style: style === 'custom' ? customStyle : '',
    purpose: purpose || '',
    preserve_headings: prefs.preserve_headings,
    preserve_lists: prefs.preserve_lists,
    length_target: prefs.length_target,
    retention_days: retentionDays,
    expires_at: expiresAtFrom(retentionDays),
    status: 'queued',
    progress: 0,
  });
}

/**
 * Drives the five-stage pipeline one short request at a time, so progress is
 * visible and a retry can resume rather than start over. Every stage is
 * idempotent: re-invoking a completed stage returns the stored result.
 */
export async function runPipeline(jobId, onUpdate = () => {}) {
  const extract = await callStage(jobId, 'extract');
  if (extract.refused) return { refused: true, reason: extract.reason };
  onUpdate({ stage: 'extract', progress: extract.progress || 15 });

  const diagnose = await callStage(jobId, 'diagnose');
  onUpdate({ stage: 'diagnose', progress: diagnose.progress || 25 });

  const chunkCount = extract.chunk_count || 1;
  for (let index = 0; index < chunkCount; index += 1) {
    const rewritten = await callStage(jobId, 'rewrite', { chunk_index: index });
    onUpdate({ stage: 'rewrite', progress: rewritten.progress || 40 });
  }

  const assembled = await callStage(jobId, 'assemble');
  onUpdate({ stage: 'assemble', progress: assembled.progress || 75 });

  let audit = await callStage(jobId, 'audit');
  onUpdate({ stage: 'audit', progress: audit.progress || 85 });

  let loops = 0;
  while (audit.has_problems && loops < MAX_REPAIR_LOOPS) {
    await callStage(jobId, 'repair');
    audit = await callStage(jobId, 'audit');
    loops += 1;
    onUpdate({ stage: 'audit', progress: audit.progress || 85 });
  }

  const final = await callStage(jobId, 'finalize');
  onUpdate({ stage: 'finalize', progress: 100 });
  return {
    refused: false,
    job: final.job,
    status: final.status,
    unresolved: final.unresolved_flags || [],
  };
}

const ACCEPTED_TYPES = ['.txt', '.md', '.markdown'];

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const name = String(file?.name || '').toLowerCase();
    if (!ACCEPTED_TYPES.some((extension) => name.endsWith(extension))) {
      reject(new Error('Only .txt and .md files can be read here. Paste .docx content instead.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsText(file);
  });
}

export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}