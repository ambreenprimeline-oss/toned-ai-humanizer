import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import SiteHeader from '@/components/SiteHeader';
import Hero from '@/components/landing/Hero';
import DemoCompare from '@/components/landing/DemoCompare';
import StageList from '@/components/landing/StageList';
import StyleGrid from '@/components/landing/StyleGrid';
import PrivacyBand from '@/components/landing/PrivacyBand';

export default function Landing() {
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    base44.auth
      .isAuthenticated()
      .then(setIsAuthed)
      .catch(() => setIsAuthed(false));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader isAuthed={isAuthed} />
      <Hero isAuthed={isAuthed} />
      <DemoCompare />
      <StageList />
      <StyleGrid />
      <PrivacyBand />
      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Humanizer edits voice and rigor. You are responsible for following your institution&apos;s
            rules on AI-assisted writing.
          </p>
          <nav className="flex items-center gap-5">
            <Link to="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}