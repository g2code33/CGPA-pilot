import { useState } from 'react';
import { INSTITUTION_LABEL } from './config/context';
import { UpdateBanner } from './components/UpdateBanner';
import { ClearButton } from './components/ClearButton';
import { Dashboard } from './views/Dashboard';
import { Calculate } from './views/Calculate';
import { Target } from './views/Target';
import { WhatIf } from './views/WhatIf';
import { FlightPathView } from './views/FlightPath';
import { Milestones } from './views/Milestones';
import { NextSemester } from './views/NextSemester';
import { PrintView } from './views/Print';
import { Privacy } from './views/Privacy';

type Tab =
  | 'dashboard'
  | 'calculate'
  | 'target'
  | 'whatif'
  | 'flight'
  | 'milestones'
  | 'next'
  | 'print'
  | 'privacy';

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '🧭' },
  { id: 'calculate', label: 'Calculate', icon: '🧮' },
  { id: 'target', label: 'Target', icon: '🎯' },
  { id: 'whatif', label: 'What-If', icon: '🔀' },
  { id: 'flight', label: 'Flight Path', icon: '🛩️' },
  { id: 'milestones', label: 'Milestones', icon: '🏁' },
  { id: 'next', label: 'Next Semester', icon: '▶️' },
  { id: 'print', label: 'Print', icon: '🖨️' },
  { id: 'privacy', label: 'Privacy', icon: '🔒' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="app-root mx-auto flex min-h-full max-w-5xl flex-col sm:flex-row">
      {/* ── Sidebar (desktop) ─────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <Brand compact />
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                tab === n.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="text-base">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-4">
          <ClearButton onClear={() => setTab('dashboard')} />
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:hidden">
            <Brand />
            <div className="ml-auto">
              <ClearButton />
            </div>
          </div>
          <UpdateBanner />
        </header>

        <main className="flex-1 px-4 pb-28 pt-4 sm:pb-10">
          {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
          {tab === 'calculate' && <Calculate />}
          {tab === 'target' && <Target />}
          {tab === 'whatif' && <WhatIf />}
          {tab === 'flight' && <FlightPathView />}
          {tab === 'milestones' && <Milestones />}
          {tab === 'next' && <NextSemester />}
          {tab === 'print' && <PrintView />}
          {tab === 'privacy' && <Privacy />}
        </main>
      </div>

      {/* ── Bottom navigation (mobile) ────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden">
        <div className="grid grid-cols-9">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[9px] font-bold leading-tight transition ${
                tab === n.id ? 'text-brand-600' : 'text-slate-400'
              }`}
            >
              <span className="text-[15px] leading-none">{n.icon}</span>
              {n.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="./icon-512.png"
        alt=""
        className="h-9 w-9 rounded-xl shadow-sm"
        width={36}
        height={36}
      />
      <div>
        <h1 className="text-sm font-black uppercase tracking-wide text-slate-900">
          CGPA <span className="text-brand-600">Pilot</span>
        </h1>
        {!compact && (
          <p className="text-[10px] font-semibold italic text-slate-400">
            Navigate Your Academic Future.
          </p>
        )}
        <p className="text-[10px] font-semibold text-brand-700">
          {INSTITUTION_LABEL}
        </p>
      </div>
    </div>
  );
}
