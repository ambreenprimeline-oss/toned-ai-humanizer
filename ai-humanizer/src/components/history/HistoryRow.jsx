import { useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import JobStatusBadge from '@/components/JobStatusBadge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDate, styleLabel } from '@/lib/constants';
import { Trash2 } from 'lucide-react';

export default function HistoryRow({ job, onDeleted }) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await base44.entities.RewriteJob.delete(job.id);
      onDeleted(job.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4">
      <div className="min-w-0">
        <p className="truncate font-heading text-base">{job.title || 'Untitled rewrite'}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {styleLabel(job.style, job.custom_style)} · {job.source_words || 0} words in ·{' '}
          {job.result_words || 0} out · {formatDate(job.created_date)}
        </p>
        {job.expires_at ? (
          <p className="mt-0.5 font-mono text-[0.68rem] text-muted-foreground">
            expires {formatDate(job.expires_at)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <JobStatusBadge status={job.status} />
        <Button asChild size="sm" variant="outline">
          <Link to={`/editor?job=${job.id}`}>Open</Link>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Delete rewrite" disabled={busy}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this rewrite?</AlertDialogTitle>
              <AlertDialogDescription>
                The text and its audit report are removed immediately. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}