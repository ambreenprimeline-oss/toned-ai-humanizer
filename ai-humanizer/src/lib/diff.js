/**
 * Paragraph-aligned tracked-change diff.
 *
 * The rewrite stage works paragraph by paragraph, so paragraphs line up
 * one-to-one in the common case. Inside a changed paragraph we run a word-level
 * LCS so the reviewer sees exactly which words moved. Every change can be
 * accepted or rejected individually and the composed text follows those choices.
 */

const MAX_DP_CELLS = 120000;

export function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function tokenize(text) {
  return String(text || '').match(/\S+\s*/g) || [];
}

function wordOps(beforeTokens, afterTokens) {
  const n = beforeTokens.length;
  const m = afterTokens.length;
  if (!n) return afterTokens.map((text) => ({ type: 'ins', text }));
  if (!m) return beforeTokens.map((text) => ({ type: 'del', text }));
  if (n * m > MAX_DP_CELLS) {
    return [
      { type: 'del', text: beforeTokens.join('') },
      { type: 'ins', text: afterTokens.join('') },
    ];
  }

  const grid = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) grid[i] = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      grid[i][j] =
        beforeTokens[i] === afterTokens[j]
          ? grid[i + 1][j + 1] + 1
          : Math.max(grid[i + 1][j], grid[i][j + 1]);
    }
  }

  const ops = [];
  const push = (type, text) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeTokens[i] === afterTokens[j]) {
      push('equal', beforeTokens[i]);
      i += 1;
      j += 1;
    } else if (grid[i + 1][j] >= grid[i][j + 1]) {
      push('del', beforeTokens[i]);
      i += 1;
    } else {
      push('ins', afterTokens[j]);
      j += 1;
    }
  }
  while (i < n) {
    push('del', beforeTokens[i]);
    i += 1;
  }
  while (j < m) {
    push('ins', afterTokens[j]);
    j += 1;
  }
  return ops;
}

export function buildReview(source, rewritten) {
  const before = splitParagraphs(source);
  const after = splitParagraphs(rewritten);
  const total = Math.max(before.length, after.length);
  const paragraphs = [];
  const changes = [];

  for (let index = 0; index < total; index += 1) {
    const original = before[index] || '';
    const result = after[index] || '';
    const changed = original !== result;
    const entry = {
      id: `p${index}`,
      index,
      before: original,
      after: result,
      changed,
      ops: changed ? wordOps(tokenize(original), tokenize(result)) : [],
    };
    paragraphs.push(entry);
    if (changed) changes.push(entry);
  }

  return { paragraphs, changes };
}

/** decisions: { [paragraphId]: boolean } - absent means accepted. */
export function composeReview(review, decisions) {
  return review.paragraphs
    .map((paragraph) => {
      if (!paragraph.changed) return paragraph.after || paragraph.before;
      const accepted = decisions[paragraph.id] !== false;
      return accepted ? paragraph.after : paragraph.before;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/** How many words a paragraph's rewrite added and removed. */
export function opStats(ops) {
  return (ops || []).reduce(
    (stats, op) => {
      const words = countWords(op.text);
      if (op.type === 'ins') stats.inserted += words;
      else if (op.type === 'del') stats.deleted += words;
      return stats;
    },
    { inserted: 0, deleted: 0 },
  );
}

/** Document-level view of the rewrite, for the tracked-changes header. */
export function reviewSummary(review) {
  const paragraphs = review?.paragraphs || [];
  const changes = review?.changes || [];
  const words = changes.reduce(
    (totals, paragraph) => {
      const stats = opStats(paragraph.ops);
      totals.inserted += stats.inserted;
      totals.deleted += stats.deleted;
      return totals;
    },
    { inserted: 0, deleted: 0 },
  );

  return {
    total: paragraphs.length,
    changed: changes.length,
    unchanged: paragraphs.length - changes.length,
    inserted: words.inserted,
    deleted: words.deleted,
  };
}