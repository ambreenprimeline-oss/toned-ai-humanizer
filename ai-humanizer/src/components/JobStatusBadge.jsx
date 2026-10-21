import { STATUS_META } from '@/lib/constants';

const TONES = {
  muted: 'bg-secondary text-secondary-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
};

export default function JobStatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Unknown', tone: 'muted' };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] ${
        TONES[meta.tone] || TONES.muted
      }`}
    >
      {meta.label}
    </span>
  );
}