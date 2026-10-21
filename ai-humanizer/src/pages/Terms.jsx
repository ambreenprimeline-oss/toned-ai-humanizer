import SiteHeader from '@/components/SiteHeader';

const SECTIONS = [
  {
    title: 'What Humanizer is',
    body: 'Humanizer is a voice-and-rigor editor. It rewrites the way a document reads and audits whether its factual content survived the rewrite unchanged. It is not an AI-detection tool and offers no assessment of how any detector will score a text.',
  },
  {
    title: 'Your responsibility',
    body: 'You must follow the rules of your school, university, employer, publisher or client on AI-assisted writing. Using this service to misrepresent who wrote a piece, or to disguise AI use from an assessor, is a breach of these terms and the service will decline such requests.',
  },
  {
    title: 'Your content',
    body: 'You keep all rights in the text you submit. You confirm you have the right to submit it. Your text is used to produce your rewrite and for nothing else: it is not used to train models and is not shared with other users.',
  },
  {
    title: 'Accuracy',
    body: 'The audit catches drift in claims, numbers, names, citations, quotations and certainty markers, and surfaces anything it cannot confirm. It is an aid to review, not a guarantee. You remain the author and the person responsible for the final text.',
  },
  {
    title: 'Availability and liability',
    body: 'The service is provided as-is without warranty. Where the law allows, the operator is not liable for indirect or consequential loss arising from use of the service.',
  },
];

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-warning/45 bg-warning/10 p-4 text-sm text-warning">
          Placeholder — legal review required before publishing.
        </div>
        <p className="eyebrow mt-10">Terms of service</p>
        <h1 className="mt-4 text-4xl">Terms</h1>
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