const POINTS = [
  {
    title: 'Retention you choose',
    body: 'Keep rewrites for 7, 30 or 90 days, or delete them the moment you close the result. Expired jobs are removed automatically.',
  },
  {
    title: 'Never used for training',
    body: 'Your text is processed to produce your rewrite. It is not stored for model training and is never reused anywhere else.',
  },
  {
    title: 'One-click deletion',
    body: 'Delete everything from the settings page and it is gone from the database immediately — not queued for a later purge.',
  },
  {
    title: 'No detector theatre',
    body: 'No detector scores, no evasion promises. Requests built on deceiving an assessor are refused, politely.',
  },
];

export default function PrivacyBand() {
  return (
    <section id="privacy" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <div className="rounded-3xl border border-border/80 bg-card p-8 sm:p-12">
        <p className="eyebrow">Privacy and honest use</p>
        <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
          Rigor applies to how the tool behaves, too.
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {POINTS.map((point) => (
            <div key={point.title}>
              <h3 className="text-base">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}