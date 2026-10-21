const STAGES = [
  {
    name: 'Extract',
    body: 'Every claim, number, name, citation and quotation is lifted out of your document and stored as ground truth before anything is touched.',
  },
  {
    name: 'Diagnose',
    body: 'A second pass reads the prose for machine habits — uniform sentence length, stock transitions, triads, empty intensifiers — and sets a rewrite plan.',
  },
  {
    name: 'Rewrite',
    body: 'The rewrite works paragraph by paragraph in your chosen voice. The paragraph is the unit of change, not the sentence.',
  },
  {
    name: 'Audit',
    body: 'Numbers, citations and quotations are checked by code first. Then an independent read compares every claim in the result with your original.',
  },
  {
    name: 'Repair',
    body: 'Anything that drifted is repaired — only the flagged lines — and re-audited. Whatever cannot be resolved is shown to you, never hidden.',
  },
];

export default function StageList() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow">How it works</p>
      <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
        Five separate passes, so the audit never grades its own homework.
      </h2>
      <ol className="mt-10 space-y-0">
        {STAGES.map((stage, index) => (
          <li
            key={stage.name}
            className="grid gap-3 border-t border-border/70 py-6 sm:grid-cols-[4rem_10rem_1fr] sm:items-baseline sm:gap-6"
          >
            <span className="font-mono text-sm text-accent">{String(index + 1).padStart(2, '0')}</span>
            <span className="font-heading text-lg">{stage.name}</span>
            <span className="leading-relaxed text-muted-foreground">{stage.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}