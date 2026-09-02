import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { INSTITUTION_LABEL, resolveContext } from './config/context';
import { UpdateButton } from './components/UpdateButton';
import { ClearButton } from './components/ClearButton';
import { UpdateBanner } from './components/UpdateBanner';
import { useAcademic } from './state/store';
import {
  installBeforeUnloadGuard,
  hasEnteredAcademicData,
} from './services/sessionGuard';
import { Calculate } from './views/Calculate';
import { Target } from './views/Target';
import { NextSemester } from './views/NextSemester';
import { WhatIf } from './views/WhatIf';
import { FlightPathView } from './views/FlightPath';
import { Milestones } from './views/Milestones';
import { Dashboard } from './views/Dashboard';
import { PrintView } from './views/Print';
import { Privacy } from './views/Privacy';
import { InstitutionSelector } from './components/InstitutionSelector';

export default function App() {
  const { state, dispatch } = useAcademic();
  const [institutionSelected, setInstitutionSelected] = useState(false);
  const [modeSelected, setModeSelected] = useState<string | null>(null);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 3000);
    return () => clearTimeout(t);
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () => installBeforeUnloadGuard(() => hasEnteredAcademicData(stateRef.current)),
    []
  );

  // Splash
  if (!splashDone) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-emerald-700 text-white overflow-hidden">
        <div className="text-center animate-pulse relative">
          <div className="mx-auto mb-6 h-28 w-28 rounded-3xl bg-white/20 backdrop-blur shadow-2xl shadow-brand-900/40 flex items-center justify-center ring-2 ring-white/30 relative">
            <img src="./icon-512.png" alt="CGPA Pilot" className="h-20 w-20 rounded-2xl shadow-lg z-10" />
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M50 15 L70 35 L90 30 L85 55 L95 60 L60 65 L55 85 L40 60 L15 55 L30 35 Z' fill='%23f59e0b' stroke='%23d97706' stroke-width='2'/%3E%3C/svg%3E" alt="Aircraft" className="absolute -top-10 -right-10 w-36 h-36 rounded-full shadow-2xl opacity-90 rotate-12 animate-bounce z-20" />
          </div>
          <h1 className="text-4xl font-black tracking-tight drop-shadow-lg">CGPA <span className="text-emerald-300">Pilot</span></h1>
          <p className="mt-3 text-base font-medium text-white/80 drop-shadow">Navigate Your Academic Future.</p>
        </div>
      </div>
    );
  }

  // Institution selection
  if (!institutionSelected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-900 via-brand-800 to-brand-600 flex flex-col items-center justify-center px-6 py-16 overflow-hidden">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-8 h-28 w-28 rounded-[2rem] bg-white/10 backdrop-blur ring-2 ring-white/20 shadow-2xl shadow-brand-900/30 flex items-center justify-center">
            <img src="./icon-512.png" alt="CGPA Pilot" className="h-20 w-20 rounded-2xl shadow-lg" />
          </div>
          <h1 className="text-5xl font-black tracking-tight text-white drop-shadow-xl">CGPA <span className="text-brand-300">Pilot</span></h1>
          <p className="mt-4 text-lg font-medium text-white/90">Navigate Your Academic Future.</p>
          <p className="mt-2 text-sm text-white/60">Select your university, school and programme.</p>
          <div className="mt-8 rounded-3xl bg-white/10 backdrop-blur-md p-6 shadow-2xl shadow-brand-900/20 ring-1 ring-white/20">
            <InstitutionSelector />
          </div>
          <button onClick={() => setInstitutionSelected(true)} className="mt-6 w-full rounded-2xl bg-white px-6 py-4 text-base font-black text-brand-800 shadow-xl hover:bg-brand-50 active:scale-[0.98] transition">Continue</button>
        </div>
      </div>
    );
  }

  // Mode selection
  if (!modeSelected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white flex flex-col items-center justify-center px-6 py-16 overflow-hidden">
        <div className="w-full max-w-sm text-center">
          <h2 className="text-2xl font-black text-slate-800">Choose your approach</h2>
          <p className="mt-2 text-sm text-slate-500">Quick for current standing. History for full trajectory.</p>
          <div className="mt-6 space-y-3">
            <button onClick={() => { dispatch({ type: 'setInputMode', inputMode: 'quick' }); setModeSelected('quick'); }} className="w-full rounded-2xl bg-brand-600 px-6 py-5 text-base font-black text-white shadow-lg hover:bg-brand-700 active:scale-[0.98] transition flex flex-col items-start gap-1">⚡ Quick Mode <span className="text-xs font-medium opacity-90">current level + current CGPA to begin</span></button>
            <button onClick={() => { dispatch({ type: 'setInputMode', inputMode: 'history' }); setModeSelected('history'); }} className="w-full rounded-2xl bg-white px-6 py-5 text-base font-black text-brand-600 ring-1 ring-brand-200 shadow-sm hover:bg-brand-50 active:scale-[0.98] transition flex flex-col items-start gap-1">📚 CGPA History <span className="text-xs font-medium opacity-80">enter each level CGPA for advance planning</span></button>
          </div>
          <div className="mt-8">
            <p className="text-xs text-slate-400">Planning mode has been removed permanently.</p>
          </div>
        </div>
      </div>
    );
  }

  // Main app layout
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white flex flex-col max-w-5xl mx-auto">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
        <Brand compact />
        <div className="mt-3"><UpdateButton /></div>

        <div className="mt-auto pt-4">
          <ClearButton />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col px-4 py-6 md:px-8 md:py-8">
        {/* Mobile header */}
        <header className="flex items-center justify-between md:hidden mb-4">
          <Brand />
          <div className="flex items-center gap-2">
            <UpdateButton />
            <ClearButton />
          </div>
        </header>

        {/* Mode info */}
        <div className="mb-4">
          <h1 className="text-2xl font-black text-slate-900">
            {modeSelected === 'quick' ? 'Quick Mode' : 'CGPA History'}
          </h1>
          <p className="text-sm text-slate-500">
            {modeSelected === 'quick'
              ? 'current level + current CGPA to begin'
              : 'enter each level CGPA for advance planning'}
          </p>
        </div>

        {/* Main content area */}
        <main className="flex-1 bg-white rounded-3xl shadow-xl shadow-brand-900/5 ring-1 ring-brand-100 p-6 overflow-auto">
          <Calculate />
        </main>

        {/* Bottom buttons */}
        <div className="flex gap-3 mt-4">
          <button onClick={() => setPage('target')} className="flex-1 rounded-2xl bg-brand-600 px-6 py-4 text-base font-black text-white shadow hover:bg-brand-700 active:scale-[0.98] transition text-center">🎯 Target</button>
          <button onClick={() => setPage('next')} className="flex-1 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-black text-white shadow hover:bg-emerald-700 active:scale-[0.98] transition text-center">▶️ Next Semester</button>
          <button onClick={() => setPage('whatif')} className="flex-1 rounded-2xl bg-violet-600 px-6 py-4 text-base font-black text-white shadow hover:bg-violet-700 active:scale-[0.98] transition text-center">🔀 What-If</button>
        </div>
      </div>
    </div>
  );
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
        active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className="text-base">{icon}</span>
      {label}
    </button>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  const ctx = resolveContext();
  const logoUrl = ctx.school?.logo ?? ctx.university?.logo ?? './icon-512.png';
  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onLogoTap(e: MouseEvent) {
    e.preventDefault();
    clicks.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (clicks.current >= 3) { clicks.current = 0; openAdminConsole(); return; }
    timer.current = setTimeout(() => { clicks.current = 0; }, 900);
  }
  function openAdminConsole() {
    const url = './admin.html';
    const inCapacitor = typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.() ?? false);
    if (inCapacitor) { window.location.href = url; return; }
    const win = window.open(url, '_blank');
    if (!win) window.location.href = url;
  }
  return (
    <div className="flex items-center gap-2.5">
      <img src={logoUrl} alt="CGPA Pilot" onClick={onLogoTap} title="CGPA Pilot" className="h-9 w-9 cursor-pointer select-none rounded-xl shadow-sm" width={36} height={36} />
      <button type="button" onClick={onLogoTap} className="cursor-pointer select-none text-left" title="CGPA Pilot">
        <h1 className="text-sm font-black uppercase tracking-wide text-slate-900">CGPA <span className="text-brand-600">Pilot</span></h1>
        {!compact && <p className="text-[10px] font-semibold italic text-slate-400">Navigate Your Academic Future.</p>}
        <p className="text-[10px] font-semibold text-brand-700">{INSTITUTION_LABEL}</p>
      </button>
    </div>
  );
}
