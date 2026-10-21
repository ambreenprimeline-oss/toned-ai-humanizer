import { Progress } from '@/components/ui/progress';
import { STAGE_LABELS } from '@/lib/constants';
import { Check, Loader2 } from 'lucide-react';

const STEPS = [
  { key: 'extract', label: 'Extract' },
  { key: 'diagnose', label: 'Diagnose' },
  { key: 'rewrite', label: 'Rewrite' },
  { key: 'assemble', label: 'Stitch' },
  { key: 'audit', label: 'Audit' },
  { key: 'finalize', label: 'Report' },
];

export default function StageProgress({ stage, progress }) {
  const currentIndex = Math.max(0, STEPS.findIndex((step) => step.key === stage));

  return (
    <section className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8">
      <p className="eyebrow">Working</p>
      <h2 className="mt-3 text-xl sm:text-2xl">{STAGE_LABELS[stage] || 'Starting the pipeline'}</h2>
      <Progress value={progress} className="mt-6 h-1.5" />
      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => {
          const done = index < currentIndex || stage === 'finalize';
          const active = index === currentIndex && stage !== 'finalize';
          return (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem] ${
                  done
                    ? 'border-success/40 bg-success/12 text-success'
                    : active
                      ? 'border-primary/40 bg-secondary text-foreground'
                      : 'border-border/80 text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : index + 1}
              </span>
              <span className={done || active ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Each stage is a separate pass with its own prompt. The audit is independent of the rewriter, so
        it never grades its own work.
      </p>
    </section>
  );
}