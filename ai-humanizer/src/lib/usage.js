export function summarizeUsage(jobs) {
  const list = jobs || [];
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);

  const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) || 0), 0);
  const sourceWords = sum(list, (job) => job.source_words);
  const resultWords = sum(list, (job) => job.result_words);
  const cost = sum(list, (job) => job.cost_estimate);
  const thisMonth = list.filter((job) => String(job.created_date || '').slice(0, 7) === monthKey);

  const months = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = date.toISOString().slice(0, 7);
    months.push({
      label: date.toLocaleString(undefined, { month: 'short' }),
      words: sum(
        list.filter((job) => String(job.created_date || '').slice(0, 7) === key),
        (job) => job.source_words,
      ),
    });
  }

  return {
    jobs: list.length,
    sourceWords,
    resultWords,
    cost,
    monthWords: sum(thisMonth, (job) => job.source_words),
    monthJobs: thisMonth.length,
    perThousandWords: sourceWords ? (cost / sourceWords) * 1000 : 0,
    months,
  };
}