// ─────────────────────────────────────────────────────────────────────────
// LiveStudentPreview — “a real live seeing at the student end”.
//
// Mounts the ACTUAL student app (src/App.tsx) full-screen, running on the
// WORKING catalog (what the admin has changed but NOT yet published). The
// working catalog is converted with the exact same buildDistribution() the
// backend uses for publishing, and injected into the in-memory runtime
// catalog — nothing is written to storage, so the real published config
// cache is never touched. On close, the previous catalog is restored.
//
// The preview chrome offers a “where my changes land” navigator: chips for
// each changed area jump the student app to the screen where the change is
// visible, and amber “● changed” marks appear on the affected tool tiles.
// ─────────────────────────────────────────────────────────────────────────

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import App, { type Screen, type StudentPreviewControls } from '../../App';
import { StoreProvider } from '../../state/store';
import { InstitutionProvider } from '../../state/institutionSelection';
import { ErrorBoundary } from '../../ErrorBoundary';
import { buildDistribution } from '../catalogPublish';
import { getRuntimeCatalog, isRuntimeCatalogSet, setRuntimeCatalog } from '../../config/runtime';
import type { AdminCatalog } from '../adminStorage';
import type { CatalogDiffReport } from '../catalogDiff';

interface LiveStudentPreviewProps {
  working: AdminCatalog;
  report: CatalogDiffReport;
  onExit: () => void;
  onPublish: () => void;
  publishing: boolean;
  /** False when there are no real changes (publish button disabled). */
  canPublish: boolean;
  onShowDiff: () => void;
}

interface Chip {
  id: string;
  icon: string;
  label: string;
  n: number;
  screen: Screen;
  badges: Partial<Record<string, string>>;
  hint: string;
}

const SCREEN_LABELS: Record<Screen, string> = {
  home: 'Home',
  calculate: 'Calculate',
  target: 'Target',
  next: 'Next Semester',
  whatif: 'What-If',
  flight: 'Flight Path',
  milestones: 'Milestones',
  ai: 'CGPA Pilot AI',
  privacy: 'Privacy',
};

function buildChips(report: CatalogDiffReport): Chip[] {
  const chips: Chip[] = [];
  if (report.universities.length > 0) {
    chips.push({
      id: 'universities',
      icon: '🏛️',
      label: 'Universities',
      n: report.universities.length,
      screen: 'home',
      badges: { calculate: 'Grading & classification rules from the university feed every calculation' },
      hint: '🏛️ University changes — institution list, grading system & classification bands. Students see these on the institution screens and in every calculation.',
    });
  }
  if (report.curricula.length > 0) {
    chips.push({
      id: 'curricula',
      icon: '📚',
      label: 'Curricula',
      n: report.curricula.length,
      screen: 'next',
      badges: {
        next: 'Course lists come straight from the published curriculum',
        milestones: 'Stage checkpoints use the course list',
      },
      hint: '📚 Curriculum changes — added / removed / modified courses. Students see them in Next Semester (course list) and Milestones (checkpoints).',
    });
  }
  if (report.appearance.length > 0) {
    chips.push({
      id: 'branding',
      icon: '🎨',
      label: 'Branding',
      n: report.appearance.length,
      screen: 'home',
      badges: {},
      hint: '🎨 Branding changes — logo, app name & tagline. Students see these on every screen (including this one’s header).',
    });
  }
  if (report.settings.length > 0) {
    const whatIfChanged = report.settings.some((c) => c.path.includes('allowWhatIf'));
    chips.push({
      id: 'settings',
      icon: '⚙️',
      label: 'Settings',
      n: report.settings.length,
      screen: whatIfChanged ? 'whatif' : 'home',
      badges: whatIfChanged ? { whatif: 'Admin turned the What-If tool on or off' } : {},
      hint: whatIfChanged
        ? '⚙️ Settings change — the What-If tool was turned on/off for students. Its tile appears (or disappears) on the home screen.'
        : '⚙️ Settings change — student permissions (visible across the app).',
    });
  }
  return chips;
}

export function LiveStudentPreview({ working, report, onExit, onPublish, publishing, canPublish, onShowDiff }: LiveStudentPreviewProps) {
  const [nav, setNav] = useState<{ screen: Screen; n: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [current, setCurrent] = useState<Screen>('home');
  const [ready, setReady] = useState(false);
  const hintTimer = useRef<number | null>(null);

  // Inject the WORKING catalog as the running student configuration.
  // In-memory only — the published config cache is never written. A layout
  // effect + ready gate guarantee the embedded app renders AFTER the swap.
  useLayoutEffect(() => {
    const wasSet = isRuntimeCatalogSet();
    const previous = wasSet ? getRuntimeCatalog() : null;
    const dist = buildDistribution(working);
    setRuntimeCatalog({
      universities: dist.universities,
      curricula: dist.curricula,
      appearance: dist.appearance,
      settings: dist.settings,
      version: null,
      updatedAt: null,
      cachedAt: new Date().toISOString(),
      source: 'local',
    });
    setReady(true);
    return () => {
      setReady(false);
      if (previous) setRuntimeCatalog(previous);
    };
  }, [working]);

  useLayoutEffect(
    () => () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    },
    []
  );

  const chips = useMemo(() => buildChips(report), [report]);
  const badges = useMemo(() => {
    const b: Partial<Record<string, string>> = {};
    for (const c of chips) Object.assign(b, c.badges);
    return b;
  }, [chips]);

  const previewControls: StudentPreviewControls = useMemo(
    () => ({ isPreview: true, nav, onScreen: setCurrent, badges }),
    [nav, badges]
  );

  function jump(chip: Chip) {
    setNav((prev) => ({ screen: chip.screen, n: (prev?.n ?? 0) + 1 }));
    setHint(chip.hint);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 6000);
  }

  return createPortal(
    <div className="fixed inset-0 z-[125] flex flex-col bg-slate-200" role="dialog" aria-modal="true" aria-label="Live student preview">
      {/* Preview bar */}
      <div className="shrink-0 border-b border-amber-300 bg-amber-400 text-amber-950 shadow-md">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="rounded-full bg-amber-950/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-50">
            👁 Live preview · NOT published
          </span>
          <span className="hidden truncate text-[11px] font-bold sm:block">
            You are seeing the student app on your WORKING catalog
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={onShowDiff}
              className="rounded-lg bg-amber-950/15 px-2.5 py-1.5 text-[11px] font-black text-amber-950 transition hover:bg-amber-950/25"
            >
              📋 Change list
            </button>
            <button
              onClick={onPublish}
              disabled={publishing || !canPublish}
              title={canPublish ? 'Publish these changes now' : 'Nothing changed — nothing to publish'}
              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {publishing ? 'Publishing…' : '🚀 Publish'}
            </button>
            <button
              onClick={onExit}
              className="grid h-7 w-7 place-items-center rounded-lg bg-amber-950/15 text-sm font-black text-amber-950 hover:bg-amber-950/25"
              aria-label="Close preview"
            >
              ✕
            </button>
          </div>
        </div>
        {/* “Where my changes land” navigator */}
        {chips.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-amber-900/80">
              Jump to the change →
            </span>
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => jump(c)}
                title={c.hint}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black transition active:scale-[0.98] ${
                  nav?.screen === c.screen ? 'bg-amber-950 text-amber-50' : 'bg-white/70 text-amber-950 hover:bg-white'
                }`}
              >
                {c.icon} {c.label} ({c.n})
              </button>
            ))}
            <span className="ml-auto hidden shrink-0 text-[10px] font-bold text-amber-900/80 md:block">
              Viewing: {SCREEN_LABELS[current]}
            </span>
          </div>
        )}
        {hint && (
          <div className="border-t border-amber-950/15 bg-amber-950/10 px-3 py-1.5 text-[11px] font-bold text-amber-950">
            {hint}
          </div>
        )}
      </div>

      {/* The REAL student app, running on the working catalog — same
          providers the student entry point uses, so it behaves exactly as
          a student would see it (fresh, empty session). */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ready ? (
          <ErrorBoundary>
            <StoreProvider>
              <InstitutionProvider>
                <App preview={previewControls} />
              </InstitutionProvider>
            </StoreProvider>
          </ErrorBoundary>
        ) : (
          <div className="grid h-full place-items-center">
            <p className="text-xs font-bold text-slate-500">Loading student site…</p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
