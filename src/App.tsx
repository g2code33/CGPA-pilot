import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { INSTITUTION_LABEL, resolveContext } from './config/context';
import { appLogoImage, appName, iconElement } from './config/branding';
import type { AppAppearance } from './config/types';
import { readCachedAppearance } from './services/configCache';
import { useInstitution, listUniversities } from './state/institutionSelection';
import { UpdateButton } from './components/UpdateButton';
import { ClearButton } from './components/ClearButton';
import { UpdateBanner } from './components/UpdateBanner';
import { useAcademic } from './state/store';
import { useDerived } from './state/derived';
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
import { Privacy } from './views/Privacy';
import { InstitutionSelector } from './components/InstitutionSelector';
import { SkySplash } from './components/SkySplash';
import { AppGlyph } from './components/AppGlyph';
import { fmt2 } from './util/format';

type Screen =
  | 'home'
  | 'calculate'
  | 'target'
  | 'next'
  | 'whatif'
  | 'flight'
  | 'milestones'
  | 'privacy';

const TOOLS: {
  id: Exclude<Screen, 'home' | 'privacy'>;
  icon: string;
  title: string;
  tagline: string;
  emoji: string;
  grad: string;
  needsData: boolean;
}[] = [
  {
    id: 'calculate',
    icon: '🧮',
    emoji: '📝',
    title: 'My results',
    tagline: 'Enter grades & see your confirmed CGPA',
    grad: 'from-slate-700 to-slate-900',
    needsData: false,
  },
  {
    id: 'target',
    icon: '🎯',
    emoji: '🎯',
    title: 'Target',
    tagline: 'Pick a goal — see if it is reachable',
    grad: 'from-brand-600 to-indigo-700',
    needsData: true,
  },
  {
    id: 'next',
    icon: '▶️',
    emoji: '▶️',
    title: 'Next Semester',
    tagline: 'Grades you need to stay on track',
    grad: 'from-emerald-600 to-teal-700',
    needsData: true,
  },
  {
    id: 'whatif',
    icon: '🔀',
    emoji: '🔀',
    title: 'What-If',
    tagline: 'Try different future GPAs',
    grad: 'from-violet-600 to-purple-700',
    needsData: true,
  },
  {
    id: 'flight',
    icon: '🛩️',
    emoji: '🛩️',
    title: 'Flight Path',
    tagline: 'Your route to graduation',
    grad: 'from-sky-600 to-blue-700',
    needsData: true,
  },
  {
    id: 'milestones',
    icon: '🏁',
    emoji: '🏁',
    title: 'Milestones',
    tagline: 'Stage-by-stage checkpoints',
    grad: 'from-orange-500 to-amber-600',
    needsData: true,
  },
];

const SCREEN_TITLES: Partial<Record<Screen, { icon: string; title: string }>> = {
  calculate: { icon: '🧮', title: 'My results & standing' },
  target: { icon: '🎯', title: 'Target' },
  next: { icon: '▶️', title: 'Next Semester' },
  whatif: { icon: '🔀', title: 'What-If Simulator' },
  flight: { icon: '🛩️', title: 'Flight Path' },
  milestones: { icon: '🏁', title: 'Milestones' },
  privacy: { icon: '🔒', title: 'Privacy' },
};

// Linear order of the tool screens so every open tool can offer an obvious
// Previous / Next at the bottom for simple thumb navigation.
const TOOL_ORDER = ['calculate', 'target', 'next', 'whatif', 'flight', 'milestones'] as const;
type ToolId = (typeof TOOL_ORDER)[number];
const isTool = (s: Screen): s is ToolId =>
  (TOOL_ORDER as readonly string[]).includes(s);

export default function App() {
  const { state, dispatch } = useAcademic();
  const d = useDerived();
  const [institutionSelected, setInstitutionSelected] = useState(false);
  const [modeSelected, setModeSelected] = useState<string | null>(null);
  const [splashDone, setSplashDone] = useState(false);
  const [splashRun, setSplashRun] = useState(0);
  const [screen, setScreen] = useState<Screen>('home');
  // Administrator-set branding/icons ride the non-personal config cache.
  const [appearance] = useState<AppAppearance | undefined>(() => readCachedAppearance());

  // Replay the Sky Dash mini-game from anywhere on the opening screens.
  function playGameAgain() {
    setSplashRun((r) => r + 1);
    setSplashDone(false);
  }

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () => installBeforeUnloadGuard(() => hasEnteredAcademicData(stateRef.current)),
    []
  );

  // Splash — "Sky Dash": press & hold to fly the aeroplane and catch stars.
  // Letting go lets the countdown resume and then loads the institution page.
  if (!splashDone) {
    return (
      <SkySplash key={splashRun} appearance={appearance} onDone={() => setSplashDone(true)} />
    );
  }

  // Institution selection
  if (!institutionSelected) {
    return (
      <div className="h-[100dvh] bg-gradient-to-b from-brand-900 via-brand-800 to-brand-600 flex flex-col items-center justify-center px-5 overflow-y-auto">
        {/* Replay the Sky Dash opening mini-game from the very top */}
        <button
          onClick={playGameAgain}
          title="Play Sky Dash mini-game"
          aria-label="Play the mini-game again"
          className="fixed right-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-black text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 active:scale-95"
        >
          🎮 Play
        </button>
        <div className="w-full max-w-md py-8 text-center">
          <div className="mx-auto mb-6 h-24 w-24 rounded-[2rem] bg-white/10 backdrop-blur ring-2 ring-white/20 shadow-2xl shadow-brand-900/30 flex items-center justify-center">
            <AppLogoImg appearance={appearance} className="h-16 w-16 rounded-2xl shadow-lg" alt="CGPA Pilot" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-xl">
            {appearance?.appName?.trim() ? (
              appearance.appName
            ) : (
              <>
                CGPA <span className="text-brand-300">Pilot</span>
              </>
            )}
          </h1>
          <p className="mt-2 text-base font-medium text-white/90">Select your university, school and programme.</p>
          <SplashInstitutionLogos />
          <div className="mt-6 rounded-3xl bg-white/10 backdrop-blur-md p-4 shadow-2xl shadow-brand-900/20 ring-1 ring-white/20">
            <InstitutionSelector />
          </div>
          <button onClick={() => setInstitutionSelected(true)} className="mt-5 w-full rounded-2xl bg-white px-6 py-4 text-base font-black text-brand-800 shadow-xl hover:bg-brand-50 active:scale-[0.98] transition">
            Continue →
          </button>
        </div>
      </div>
    );
  }

  // Mode selection
  if (!modeSelected) {
    return (
      <div className="h-[100dvh] bg-gradient-to-b from-brand-50 to-white flex flex-col items-center justify-center px-5 overflow-y-auto">
        <div className="w-full max-w-sm py-8 text-center">
          <h2 className="text-2xl font-black text-slate-800">How do you want to start?</h2>
          <p className="mt-1 text-sm text-slate-500">You can change this later at any time.</p>
          <div className="mt-6 space-y-3">
            <button onClick={() => { dispatch({ type: 'setInputMode', inputMode: 'quick' }); setModeSelected('quick'); }} className="w-full rounded-2xl bg-brand-600 px-5 py-4 text-left text-base font-black text-white shadow-lg hover:bg-brand-700 active:scale-[0.98] transition">
              ⚡ Quick Mode
              <span className="block text-xs font-medium opacity-90">Current level + CGPA to begin</span>
            </button>
            <button onClick={() => { dispatch({ type: 'setInputMode', inputMode: 'history' }); setModeSelected('history'); }} className="w-full rounded-2xl bg-white px-5 py-4 text-left text-base font-black text-brand-600 ring-1 ring-brand-200 shadow-sm hover:bg-brand-50 active:scale-[0.98] transition">
              📚 CGPA History
              <span className="block text-xs font-medium opacity-80">Enter each level for advance planning</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Tool screens (drill-in). Fixed app frame: header + scrollable content +
  // a Previous / Next / Home bottom bar for simple navigation.
  if (screen !== 'home') {
    const meta = SCREEN_TITLES[screen];
    const idx = TOOL_ORDER.indexOf(screen as ToolId);
    const prev = isTool(screen) && idx > 0 ? TOOLS[idx - 1] : null;
    const next = isTool(screen) && idx < TOOL_ORDER.length - 1 ? TOOLS[idx + 1] : null;
    return (
      <div className="h-[100dvh] flex flex-col bg-slate-50">
        <header className="no-print shrink-0 flex items-center gap-2 border-b border-slate-200/70 bg-white/70 px-3 py-1.5 backdrop-blur">
          <button
            onClick={() => setScreen('home')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 ring-1 ring-slate-200 transition active:scale-95"
            aria-label="Back to home"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1 truncate text-[13px] font-extrabold text-slate-900">
              {meta && (
                <SlotGlyph
                  appearance={appearance}
                  slot={screen}
                  fallback={meta.icon}
                  imgCls="h-4 w-4 shrink-0 object-contain"
                />
              )}
              <span className="truncate">{meta?.title}</span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <UpdateButton />
            <ClearButton />
          </div>
        </header>
        <div className="app-frame flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          <div className="mx-auto w-full max-w-md">
            {screen === 'calculate' && <Calculate onProceed={() => setScreen('home')} />}
            {screen === 'target' && <Target />}
            {screen === 'next' && <NextSemester />}
            {screen === 'whatif' && <WhatIf />}
            {screen === 'flight' && <FlightPathView />}
            {screen === 'milestones' && <Milestones />}
            {screen === 'privacy' && <Privacy />}
          </div>
        </div>
        {/* Bottom tool navigation */}
        <nav className="no-print shrink-0 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            {isTool(screen) && prev ? (
              <button
                onClick={() => setScreen(prev.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 py-2 text-left text-brand-700 active:scale-95"
              >
                <span className="text-lg leading-none">‹</span>
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Prev
                  </span>
                  <span className="block truncate text-xs font-black">{prev.title}</span>
                </span>
              </button>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            <button
              onClick={() => setScreen('home')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-indigo-700 text-lg text-white shadow active:scale-95"
              aria-label="Home"
              title="Home"
            >
              🏠
            </button>
            {isTool(screen) && next ? (
              <button
                onClick={() => setScreen(next.id)}
                className="flex min-w-0 flex-1 items-center justify-end gap-1.5 rounded-xl px-2 py-2 text-right text-brand-700 active:scale-95"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Next
                  </span>
                  <span className="block truncate text-xs font-black">{next.title}</span>
                </span>
                <span className="text-lg leading-none">›</span>
              </button>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
          </div>
        </nav>
      </div>
    );
  }

  // ── HOME HUB ─────────────────────────────────────────────────────────
  // "Results entered" == the user has typed a CGPA (Quick: current standing;
  // History: at least one completed level). This mirrors the Proceed gate so
  // proceeding home actually unlocks the tools and shows the entered state.
  const resultsEntered =
    d.state.mode === 'history'
      ? d.state.semesters.some((s) => s.gpa !== null)
      : d.state.baseline.cgpa !== null;
  const hasData = resultsEntered;
  const heroCgpa =
    d.record.cgpa !== null
      ? d.record.cgpa
      : d.state.mode === 'history'
        ? (d.state.semesters.find((s) => s.gpa !== null)?.gpa ?? null)
        : d.state.baseline.cgpa;
  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-brand-50 to-white">
      <header className="no-print shrink-0 flex items-center justify-between gap-2 border-b border-slate-200/70 bg-white/70 px-3 py-1.5 backdrop-blur">
        <Brand appearance={appearance} />
        <div className="flex shrink-0 items-center gap-1.5">
          <UpdateButton />
          <ClearButton />
        </div>
      </header>
      <UpdateBanner />
      <div className="app-frame flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        <div className="mx-auto w-full max-w-md">
          {/* Hero */}
          <section className="mt-1 rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 p-5 text-white shadow-xl shadow-brand-900/10 ring-1 ring-white/10">
            {hasData ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-black text-emerald-200 ring-1 ring-emerald-300/40">
                    ✓ Results entered
                  </span>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-200">
                    Your confirmed CGPA
                  </p>
                  <p className="mt-1 text-5xl font-black tabular-nums leading-none">
                    {heroCgpa !== null ? fmt2(heroCgpa) : '—'}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-brand-100">
                    🏅 {d.classBand?.label ?? '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-200">
                    Level {d.state.baseline.levelIndex * 100}
                    {d.record.creditHours > 0 ? ` · ${d.record.creditHours} graded credits` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-200">
                    Target
                  </p>
                  <p className="mt-1 text-5xl font-black tabular-nums leading-none text-emerald-300">
                    {fmt2(d.state.targetCgpa ?? 3.6)}
                  </p>
                  <p className="mt-2 text-[11px] text-brand-100">your chosen goal</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="flex items-center justify-center text-3xl">
                  <AppGlyph appearance={appearance} slot="plane" fallback="✈️" size={34} />
                </p>
                <h2 className="mt-2 text-lg font-black">Let’s get you off the ground</h2>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-100">
                  Start in <strong className="text-white">My results</strong> and enter
                  your current level + CGPA. Every tool below then works from that one
                  number — nothing is saved or shared.
                </p>
                <button
                  onClick={() => setScreen('calculate')}
                  className="mt-4 rounded-2xl bg-white px-6 py-3 text-sm font-black text-brand-700 shadow-lg active:scale-[0.98]"
                >
                  📝 Enter my results
                </button>
              </div>
            )}
          </section>

          {hasData && (
            <button
              onClick={() => setScreen('calculate')}
              className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 active:scale-[0.99]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-lg text-brand-700 ring-1 ring-brand-100">✏️</span>
              <span className="flex-1">
                <span className="block text-sm font-extrabold text-slate-800">Edit results</span>
                <span className="block text-[11px] text-slate-500">Change your level, CGPA or not-released courses</span>
              </span>
              <span className="text-slate-300">›</span>
            </button>
          )}

          {/* Tool tiles */}
          <p className="mt-5 mb-2 px-1 text-[11px] font-black uppercase tracking-[0.15em] text-slate-400">
            Tools
          </p>
          <div className="space-y-2.5">
            {TOOLS.map((t) => {
              const disabled = t.needsData && !hasData;
              const isResults = t.id === 'calculate';
              const tagline = isResults && hasData ? 'Results entered — tap to Edit' : t.tagline;
              return (
                <button
                  key={t.id}
                  onClick={() => !disabled && setScreen(t.id)}
                  disabled={disabled}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition ${
                    disabled
                      ? 'bg-slate-100 ring-slate-200 opacity-70'
                      : 'bg-white ring-slate-200 shadow-sm active:scale-[0.99]'
                  }`}
                >
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br text-xl text-white shadow ${t.grad}`}
                  >
                    <SlotGlyph appearance={appearance} slot={t.id} fallback={t.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold text-slate-900">
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{tagline}</span>
                  </span>
                  {disabled ? (
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-[9px] font-bold text-slate-500">
                      add results first
                    </span>
                  ) : isResults && hasData ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">
                      ✓ entered
                    </span>
                  ) : (
                    <span className="shrink-0 text-slate-300">›</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Privacy */}
          <button
            onClick={() => setScreen('privacy')}
            className="mt-5 flex w-full items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-left ring-1 ring-emerald-200"
          >
            <span className="flex h-6 w-6 items-center justify-center text-lg">
              <SlotGlyph appearance={appearance} slot="privacy" fallback="🔒" imgCls="h-5 w-5 object-contain" />
            </span>
            <span className="flex-1 text-xs font-bold text-emerald-800">
              No account. Nothing you type is saved or shared — see how.
            </span>
            <span className="text-emerald-400">›</span>
          </button>

          <p className="mt-5 px-2 text-center text-[10px] leading-relaxed text-slate-400">
            {d.university.shortName} grading &amp; classification per published
            university rules · CGPA PILOT is an unofficial planning aid, not an
            academic record.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The app logo shown at opening and in the header — administrator-changeable. */
function AppLogoImg({
  appearance,
  className,
  alt,
}: {
  appearance?: AppAppearance;
  className?: string;
  alt?: string;
}) {
  const src = appLogoImage(appearance);
  return src ? (
    <img src={src} alt={alt ?? 'app logo'} className={className} />
  ) : (
    <img src="./icon-512.png" alt={alt ?? 'CGPA Pilot'} className={className} />
  );
}

/** Renders an appearance-overridable icon slot as an image or its emoji. */
function SlotGlyph({
  appearance,
  slot,
  fallback,
  imgCls,
}: {
  appearance?: AppAppearance;
  slot: string;
  fallback: string;
  imgCls?: string;
}) {
  const el = iconElement(appearance?.icons?.[slot], fallback);
  if (el.type === 'img') {
    return <img src={el.src} alt={el.alt ?? ''} className={`object-contain ${imgCls ?? 'h-6 w-6'}`} />;
  }
  return <span className="inline-flex leading-none">{el.text}</span>;
}

/**
 * Institution & department logos shown directly under the caption
 * “Select your university, school and programme.” Only the currently
 * selected university and its active departments are shown (from the
 * published catalog). Renders nothing when no logos are set.
 */
function SplashInstitutionLogos() {
  const { context } = useInstitution();
  const uni = listUniversities().find((u) => u.id === context.universityId);
  const depts = uni?.schools.filter((s) => s.status === 'active') ?? [];
  const items: { src?: string; emoji: string; name: string }[] = [];
  if (uni) items.push({ src: uni.logo, emoji: '🏛️', name: uni.shortName || uni.name });
  for (const d of depts) items.push({ src: d.logo, emoji: '🏢', name: d.name });
  const anyLogo = items.some((i) => i.src);
  if (!anyLogo) return null;
  return (
    <div className="mt-3 flex flex-wrap items-start justify-center gap-3">
      {items.map((it, i) => (
        <div key={i} className="flex w-14 flex-col items-center gap-1">
          {it.src ? (
            <img
              src={it.src}
              alt={`${it.name} logo`}
              className="h-11 w-11 rounded-xl bg-white object-contain p-0.5 shadow ring-1 ring-white/25"
            />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-xl ring-1 ring-white/20">
              {it.emoji}
            </span>
          )}
          <span className="max-w-full truncate text-[9px] font-bold leading-tight text-white/85" title={it.name}>
            {it.name}
          </span>
        </div>
      ))}
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

function Brand({ compact = false, appearance }: { compact?: boolean; appearance?: AppAppearance }) {
  const ctx = resolveContext();
  const logoUrl =
    ctx.school?.logo ??
    ctx.university?.logo ??
    appLogoImage(appearance) ??
    './icon-512.png';
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
    <div className="flex min-w-0 items-center gap-2">
      <img src={logoUrl} alt={appName(appearance)} onClick={onLogoTap} title={appName(appearance)} className="h-8 w-8 shrink-0 cursor-pointer select-none rounded-lg shadow-sm" width={32} height={32} />
      <button type="button" onClick={onLogoTap} className="cursor-pointer select-none text-left leading-tight" title={appName(appearance)}>
        <h1 className="font-extrabold tracking-tight text-slate-900" style={{ fontSize: 13 }}>
          {appearance?.appName?.trim() ? (
            appearance.appName
          ) : (
            <>
              CGPA <span className="text-brand-600">Pilot</span>
            </>
          )}
        </h1>
        {!compact && (
          <p className="text-[10px] font-medium leading-tight text-slate-500">
            {INSTITUTION_LABEL}
          </p>
        )}
      </button>
    </div>
  );
}
