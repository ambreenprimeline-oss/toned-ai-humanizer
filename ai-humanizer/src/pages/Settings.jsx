import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import { RETENTION_OPTIONS } from '@/lib/constants';

export default function Settings() {
  const [retention, setRetention] = useState(30);
  const [savedRetention, setSavedRetention] = useState(30);
  const [settingId, setSettingId] = useState(null);
  const [summary, setSummary] = useState({ jobs: 0, words: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    const [settings, jobs] = await Promise.all([
      base44.entities.UserSetting.list('-created_date', 1),
      base44.entities.RewriteJob.list('-created_date', 200),
    ]);
    const setting = settings?.[0];
    if (setting) {
      setSettingId(setting.id);
      setRetention(setting.retention_days ?? 30);
      setSavedRetention(setting.retention_days ?? 30);
    }
    setSummary({
      jobs: jobs.length,
      words: jobs.reduce((total, job) => total + (job.source_words || 0) + (job.result_words || 0), 0),
    });
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (settingId) {
        await base44.entities.UserSetting.update(settingId, { retention_days: retention });
      } else {
        const created = await base44.entities.UserSetting.create({ retention_days: retention });
        setSettingId(created.id);
      }
      setSavedRetention(retention);
      setMessage('Saved. New rewrites follow this window.');
    } finally {
      setSaving(false);
    }
  };

  const wipe = async () => {
    setWiping(true);
    try {
      const me = await base44.auth.me();
      await base44.entities.RewriteJob.deleteMany({ created_by_id: me.id });
      setMessage('Every rewrite, tracked change and audit report has been deleted.');
      await load();
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">Data &amp; settings</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">Your text, your window.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Nothing you paste is used for training, and nothing is kept longer than the window you pick
          here.
        </p>
      </header>

      {message ? (
        <div className="rounded-2xl border border-success/35 bg-success/10 p-4 text-sm text-success">
          {message}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/80 bg-card p-6">
          <p className="eyebrow">Retention</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Applies to new rewrites. Expired ones are deleted automatically when you open your
            history.
          </p>
          <RadioGroup
            value={String(retention)}
            onValueChange={(value) => setRetention(Number(value))}
            className="mt-5 space-y-3"
          >
            {RETENTION_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start gap-3">
                <RadioGroupItem value={String(option.value)} id={`retention-${option.value}`} className="mt-0.5" />
                <Label htmlFor={`retention-${option.value}`} className="font-normal leading-relaxed">
                  {option.label}
                  {option.note ? <span className="block text-xs text-muted-foreground">{option.note}</span> : null}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <Button
            className="mt-6"
            onClick={save}
            disabled={saving || loading || retention === savedRetention}
          >
            {saving ? 'Saving' : retention === savedRetention ? 'Saved' : 'Save retention window'}
          </Button>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border/80 bg-card p-6">
            <p className="eyebrow">What is stored</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Rewrites kept</dt>
                <dd className="font-mono">{summary.jobs}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Words stored</dt>
                <dd className="font-mono">{summary.words.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Voice samples</dt>
                <dd className="font-mono">none</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Files you open are read in your browser and never uploaded.
            </p>
          </div>

          <div className="rounded-2xl border border-destructive/35 bg-destructive/5 p-6">
            <p className="eyebrow text-destructive">Delete everything</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Removes every rewrite, tracked change, audit report and the retention setting from the
              database immediately, not on a later sweep.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="mt-4" disabled={wiping}>
                  {wiping ? 'Deleting' : 'Delete all my data'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every rewrite and audit report is removed immediately and cannot be recovered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my data</AlertDialogCancel>
                  <AlertDialogAction onClick={wipe}>Delete everything</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p className="text-xs text-muted-foreground">
            <Link to="/terms" className="underline underline-offset-4">
              Terms
            </Link>{' '}
            ·{' '}
            <Link to="/privacy" className="underline underline-offset-4">
              Privacy
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}