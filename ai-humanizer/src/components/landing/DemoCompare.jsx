const BEFORE = [
  "In today's rapidly evolving landscape, it is important to note that AI writing assistants have become a pivotal tool for teams. Moreover, they offer a robust and seamless solution that underscores the vital importance of clear communication. Furthermore, studies suggest that around 42% of teams now rely on them weekly, and this number is likely to grow.",
];

const AFTER = [
  'AI writing assistants are now ordinary equipment for teams. Studies suggest roughly 42% of them rely on one weekly, and that number is likely to grow. What they protect is not speed but clarity: a draft that still reads like the person who signs it.',
];

export default function DemoCompare() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-border/80 bg-muted/40 p-6">
          <p className="eyebrow">Before</p>
          {BEFORE.map((paragraph) => (
            <p key={paragraph} className="mt-4 leading-relaxed text-muted-foreground">
              {paragraph}
            </p>
          ))}
          <p className="mt-5 font-mono text-xs text-muted-foreground">
            3 stock transitions · 1 triad · 2 buzzwords · uniform rhythm
          </p>
        </article>
        <article className="rounded-2xl border border-primary/25 bg-card p-6 shadow-sm">
          <p className="eyebrow">After — same facts, same hedge, your voice</p>
          {AFTER.map((paragraph) => (
            <p key={paragraph} className="mt-4 leading-relaxed">
              {paragraph}
            </p>
          ))}
          <p className="mt-5 font-mono text-xs text-success">
            42% preserved · &ldquo;likely&rdquo; preserved · 0 claims added
          </p>
        </article>
      </div>
    </section>
  );
}