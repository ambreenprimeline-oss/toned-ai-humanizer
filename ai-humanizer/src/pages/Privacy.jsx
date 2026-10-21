import SiteHeader from '@/components/SiteHeader';

const SECTIONS = [
  {
    title: 'What we store',
    body: 'The text you submit, the rewrite, the audit report, and the settings you choose. If you open a file on your device it is read in your browser and never uploaded.',
  },
  {
    title: 'How long we keep it',
    body: 'You choose the window: 7, 30 or 90 days, or delete-as-soon-as-you-close-the-result. Expired rewrites are deleted automatically when you next open your history, and "delete everything" in settings removes them immediately.',
  },
  {
    title: 'How it is processed',
    body: 'Your text is sent to the language model configured for this app so that it can be diagnosed, rewritten and audited. It is not used to train models and is not used to improve anyone else\'s results.',
  },
  {
    title: 'Access',
    body: 'Rewrites are private to your account. Row-level rules in the database mean another signed-in user cannot read, change or delete your records even if they guess an identifier.',
  },
  {
    title: 'Your controls',
    body: 'You can delete any single rewrite from your history, change the retention window at any time, and delete all of your data in one action. Deletion removes the records from the database.',
  },
  {
    title: 'Logs',
    body: 'Operational logs record which stage ran, which model was used, how many tokens it consumed and how long it took. They never contain your text.',
  },
];

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-warning/45 bg-warning/10 p-4 text-sm text-warning">
          Placeholder — legal review required before publishing.
        </div>
        <p className="eyebrow mt-10">Privacy policy</p>
        <h1 className="mt-4 text-4xl">Privacy</h1>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg">{section.title}</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}