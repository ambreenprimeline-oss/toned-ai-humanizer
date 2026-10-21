import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createJob, readTextFile, runPipeline } from '@/lib/humanize';
import { buildReview, composeReview } from '@/lib/diff';
import InputPane from '@/components/editor/InputPane';
import ControlPane from '@/components/editor/ControlPane';
import StageProgress from '@/components/editor/StageProgress';
import ResultPanel from '@/components/editor/ResultPanel';
import { AlertTriangle } from 'lucide-react';

const MAX_CHARS = 20000;
const EMPTY_FORM = {
  text: '',
  filename: '',
  style: 'professional_researcher',
  customStyle: '',
  purpose: '',
  prefs: { preserve_headings: true, preserve_lists: true, length_target: 'same' },
};

export default function Editor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [retention, setRetention] = useState(30);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [decisions, setDecisions] = useState({});

  const jobId = searchParams.get('job');

  useEffect(() => {
    base44.entities.UserSetting.list('-created_date', 1)
      .then((rows) => {
        const stored = rows?.[0]?.retention_days;
        if (stored !== undefined && stored !== null) setRetention(stored);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    base44.entities.RewriteJob.get(jobId)
      .then((record) => {
        if (active) {
          setJob(record);
          setDecisions({});
        }
      })
      .catch(() => {
        if (active) setError('That rewrite could not be found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  const review = useMemo(
    () => (job?.final_text ? buildReview(job.source_text || '', job.final_text) : null),
    [job],
  );
  const text = useMemo(
    () => (review ? composeReview(review, decisions) : job?.final_text || ''),
    [review, decisions, job],
  );

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const handleRun = async () => {
    setError('');
    setRefusal('');
    setDecisions({});
    if (!form.text.trim()) {
      setError('Paste or open a document first.');
      return;
    }
    if (form.text.length > MAX_CHARS) {
      setError(`That document is ${form.text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}.`);
      return;
    }

    setRunning(true);
    setStage('extract');
    setProgress(0);
    let created = null;
    try {
      created = await createJob({
        text: form.text,
        style: form.style,
        customStyle: form.customStyle,
        purpose: form.purpose,
        prefs: form.prefs,
        retentionDays: retention,
        filename: form.filename,
      });
      setJob(created);
      setSearchParams({ job: created.id }, { replace: true });

      const result = await runPipeline(created.id, ({ stage: nextStage, progress: nextProgress }) => {
        setStage(nextStage);
        setProgress(nextProgress);
      });

      if (result.refused) {
        setRefusal(result.reason);
        setJob(await base44.entities.RewriteJob.get(created.id));
        return;
      }

      if (retention === 0) {
        const finished = result.job;
        await base44.entities.RewriteJob.delete(created.id);
        setSearchParams({}, { replace: true });
        setJob({ ...finished, id: created.id, retention_days: 0 });
      } else {
        setJob(result.job || (await base44.entities.RewriteJob.get(created.id)));
      }
    } catch (runError) {
      const message = runError.message || 'The rewrite failed.';
      setError(message);
      if (created) {
        try {
          await base44.entities.RewriteJob.update(created.id, { status: 'failed', error: message });
          setJob(await base44.entities.RewriteJob.get(created.id));
        } catch {
          setJob(null);
        }
      }
    } finally {
      setRunning(false);
    }
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setJob(null);
    setDecisions({});
    setError('');
    setRefusal('');
    setStage('');
    setProgress(0);
    setSearchParams({}, { replace: true });
  };

  const showResult = !running && !!job?.final_text;
  const jobFailure = job?.status === 'failed' || job?.status === 'refused' ? job?.error : '';

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <p className="eyebrow">Rewrite</p>
        <h1 className="mt-3 text-3xl sm:text-4xl">Voice and rigor, paragraph by paragraph.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Humanizer edits how a document reads. Facts, numbers, names, citations and how certain each
          claim is are preserved — and audited afterwards by a pass that never saw the rewrite plan.
        </p>
      </header>

      {refusal ? (
        <div className="rounded-2xl border border-warning/45 bg-warning/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> This request was declined
          </p>
          <p className="mt-2 leading-relaxed text-foreground/90">{refusal}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Rewrite the same document with a purpose such as &ldquo;editing my own draft&rdquo; and it
            will run normally.
          </p>
        </div>
      ) : null}

      {error || jobFailure ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error || jobFailure}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading that rewrite…</p> : null}

      {running ? <StageProgress stage={stage} progress={progress} /> : null}

      {showResult ? (
        <ResultPanel
          job={job}
          review={review}
          decisions={decisions}
          onToggle={(id) =>
            setDecisions((current) => ({ ...current, [id]: current[id] === false ? true : false }))
          }
          onAll={(accept) =>
            setDecisions(
              accept ? {} : Object.fromEntries(review.changes.map((change) => [change.id, false])),
            )
          }
          text={text}
          onNew={handleNew}
        />
      ) : null}

      {!running && !showResult && !loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <InputPane
            value={form}
            onChange={update}
            onFile={readTextFile}
            onError={setError}
            maxChars={MAX_CHARS}
          />
          <ControlPane value={form} onChange={update} onRun={handleRun} running={running} retentionDays={retention} />
        </div>
      ) : null}
    </div>
  );
}