const SEVERITY = {
  high: 'bg-destructive/12 text-destructive',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-secondary text-secondary-foreground',
};

export default function NotesPanel({ job }) {
  const findings = job.diagnosis?.findings || [];
  const notes = String(job.notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="eyebrow">Editor&apos;s notes</p>
        <ul className="space-y-2">
          {notes.map((line, index) => (
            <li key={index} className="text-sm leading-relaxed text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      </div>

      {findings.length ? (
        <div className="space-y-2">
          <p className="eyebrow">AI patterns found in the original</p>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
            {findings.map((finding, index) => (
              <li key={index} className="flex flex-wrap items-start justify-between gap-3 bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm">{finding.pattern}</p>
                  <p className="mt-0.5 truncate font-mono text-[0.68rem] text-muted-foreground">
                    {finding.location}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.12em] ${
                    SEVERITY[finding.severity] || SEVERITY.low
                  }`}
                >
                  {finding.severity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="font-mono text-xs text-muted-foreground">
        {job.provider} · {job.model_quality} / {job.model_fast} · prompt {job.prompt_version}
      </p>
    </div>
  );
}