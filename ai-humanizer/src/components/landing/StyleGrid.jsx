import { STYLE_OPTIONS } from '@/lib/constants';

export default function StyleGrid() {
  return (
    <section id="styles" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Voices</p>
      <h2 className="mt-4 max-w-2xl text-3xl sm:text-4xl">
        Pick a register, or describe your own in a sentence.
      </h2>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STYLE_OPTIONS.map((style) => (
          <article key={style.value} className="rounded-2xl border border-border/80 bg-card p-6">
            <h3 className="text-lg">{style.label}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{style.blurb}</p>
          </article>
        ))}
        <article className="rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <h3 className="text-lg">Custom voice</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            &ldquo;Plain and short. No throat-clearing.&rdquo; Your instruction governs register; the
            preservation rules still govern every fact.
          </p>
        </article>
      </div>
    </section>
  );
}