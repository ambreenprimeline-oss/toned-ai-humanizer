import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Check, LogOut, Menu, X } from 'lucide-react';

const NAV = [
  { to: '/editor', label: 'Rewrite' },
  { to: '/history', label: 'History' },
  { to: '/usage', label: 'Usage' },
  { to: '/settings', label: 'Data & settings' },
];

export default function AppLayout() {
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    base44.auth
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const linkClass = ({ isActive }) =>
    [
      'rounded-full px-3 py-1.5 text-sm transition-colors',
      isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
    ].join(' ');

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavLink to="/editor" className="flex items-center gap-2">
            <span className="font-heading text-lg tracking-tight">Humanizer</span>
            <span className="hidden text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              voice &amp; rigor
            </span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm text-muted-foreground">{user?.full_name || user?.email || ''}</span>
            <Button variant="ghost" size="sm" onClick={() => base44.auth.logout('/login')}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {open ? (
          <div className="border-t border-border/70 px-4 pb-4 pt-2 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={linkClass}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="justify-start px-3 text-muted-foreground"
                onClick={() => base44.auth.logout('/login')}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
              </Button>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="rule">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5" />
            Facts, numbers, names and citations are audited on every job. Nothing is used for training.
          </p>
          <p>{user?.email || ''}</p>
        </div>
      </footer>
    </div>
  );
}