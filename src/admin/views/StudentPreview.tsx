import { useMemo, useState } from 'react';
import { useAdmin } from '../adminStore';
import type { Programme, School, University } from '../../config/types';
import type { AppAppearance } from '../../config/types';
import { SkySplash } from '../../components/SkySplash';
import { AppGlyph } from '../../components/AppGlyph';
import { appLogoImage, appName, tagline } from '../../config/branding';

/**
 * A faithful, interactive preview of the STUDENT app, driven entirely by the
 * admin's current catalog (institutions, departments, programmes, logos and
 * the appearance/icons set in the Icon & Branding manager).
 *
 * It reproduces the exact journey and navigation a student sees:
 *   Sky Dash mini-game → institution selection → Quick/History mode
 *   → home hub → drill into a tool (header + bottom Prev/Next/Home nav).
 */

interface ToolMeta {
  title: string;
  tagline: string;
  emoji: string;
  needsData: boolean;
}
const TOOL_META: Record<string, ToolMeta> = {
  calculate: { title: 'My results', tagline: 'Enter grades & see your confirmed CGPA', emoji: '🧮', needsData: false },
  target: { title: 'Target', tagline: 'Pick a goal — see if it is reachable', emoji: '🎯', needsData: true },
  next: { title: 'Next Semester', tagline: 'Grades you need to stay on track', emoji: '▶️', needsData: true },
  whatif: { title: 'What-If', tagline: 'Try different future GPAs', emoji: '🔀', needsData: true },
  flight: { title: 'Flight Path', tagline: 'Your route to graduation', emoji: '🛩️', needsData: true },
  milestones: { title: 'Milestones', tagline: 'Stage-by-stage checkpoints', emoji: '🏁', needsData: true },
};
const TOOL_ORDER = ['calculate', 'target', 'next', 'whatif', 'flight', 'milestones'];
// The preview is ALWAYS full phone size — a fixed 390×800 device frame
// (standard smartphone), with the journey content scrolling inside it, at
// every stage (game, selection, mode, home, tools).
const FRAME_W = 390;
const FRAME_H = 800;
// Inner content height = frame height minus the 4px device border on each side.
const FRAME_CONTENT_H = FRAME_H - 8;

type Stage = 'game' | 'select' | 'mode' | 'home';
type ToolId = (typeof TOOL_ORDER)[number];

export function StudentPreview() {
  const { catalog } = useAdmin();
  const appearance = catalog.appearance;
  const playSplash = catalog.settings?.playIntroSplash !== false;
  const whatIfAllowed = catalog.settings?.allowWhatIf !== false;
  const [stage, setStage] = useState<Stage>(playSplash ? 'game' : 'select');
  const [mode, setMode] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [gameKey, setGameKey] = useState(0);

  const universities = useMemo(
    () => catalog.universities.filter((u) => u.status === 'active'),
    [catalog]
  );
  const [uniId, setUniId] = useState<string>(universities[0]?.id ?? '');
  const university = universities.find((u) => u.id === uniId);
  const departments = university?.schools.filter((s) => s.status === 'active') ?? [];
  const [schoolId, setSchoolId] = useState<string>(departments[0]?.id ?? '');
  const department = departments.find((s) => s.id === schoolId);
  const programmes = department?.programmes.filter((p) => p.status === 'active') ?? [];
  const [progId, setProgId] = useState<string>(programmes[0]?.id ?? '');
  const programme = programmes.find((p) => p.id === progId);

  const publishedCount = catalog.curricula.filter((c) => c.status === 'published').length;
  const label = [university?.shortName, department?.name, programme?.shortName || programme?.name]
    .filter(Boolean)
    .join(' · ');

  const hasData = false; // preview always starts like a brand-new student (no results yet)

  function playGame() {
    if (!playSplash) return;
    setGameKey((k) => k + 1);
    setStage('game');
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Student preview</h1>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
        <span>🎬 Live preview · {publishedCount} published curriculum{publishedCount === 1 ? '' : 's'}</span>
        {playSplash && (
          <button
            onClick={playGame}
            className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-black text-brand-700 ring-1 ring-amber-300 transition hover:bg-brand-50"
          >
            🎮 Replay Sky Dash
          </button>
        )}
        <button
          onClick={() => {
            setStage(playSplash ? 'game' : 'select');
            setMode(null);
            setTool(null);
          }}
          className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-black text-slate-500 ring-1 ring-amber-300 transition hover:bg-slate-100"
        >
          ↺ Restart journey
        </button>
      </div>

      {/* Device frame — always full phone size */}
      <div
        className="mx-auto overflow-hidden rounded-[2.2rem] border-4 border-slate-800 bg-slate-100 shadow-2xl"
        style={{ width: `min(${FRAME_W}px, 100%)`, height: FRAME_H }}
      >
        {stage === 'game' && playSplash && (
          <SkySplash key={gameKey} appearance={appearance} height={FRAME_CONTENT_H} onDone={() => setStage('select')} />
        )}

        {stage === 'select' && (
          <SelectionScreen
            appearance={appearance}
            onPlay={playGame}
            universities={universities}
            university={university}
            departments={departments}
            department={department}
            programmes={programmes}
            uniId={uniId}
            setUniId={(id) => {
              setUniId(id);
              const u = universities.find((x) => x.id === id);
              const d = u?.schools.find((s) => s.status === 'active');
              setSchoolId(d?.id ?? '');
              setProgId(d?.programmes.find((p) => p.status === 'active')?.id ?? '');
            }}
            schoolId={schoolId}
            setSchoolId={(id) => {
              setSchoolId(id);
              const d = departments.find((s) => s.id === id);
              setProgId(d?.programmes.find((p) => p.status === 'active')?.id ?? '');
            }}
            progId={progId}
            setProgId={setProgId}
            onContinue={() => setStage('mode')}
          />
        )}

        {stage === 'mode' && (
          <ModeScreen appearance={appearance} onPick={(m) => { setMode(m); setStage('home'); }} />
        )}

        {stage === 'home' && (
          <HomeScreen
            appearance={appearance}
            institutionLabel={label}
            published={publishedCount > 0}
            hasData={hasData}
            mode={mode}
            tool={tool}
            setTool={(t) => setTool(t)}
            onBackHome={() => setTool(null)}
            whatIfAllowed={whatIfAllowed}
          />
        )}
      </div>

      <p className="mx-auto max-w-md text-center text-[10px] text-slate-400">
        The preview has no entered student data, so it opens like a fresh
        student: tools that need results are locked until “My results” is
        completed.
      </p>
    </div>
  );
}

/* ── Institution selection (mirrors the student splash/select screen) ──── */

function SelectionScreen(props: {
  appearance?: AppAppearance;
    onPlay?: () => void;
  universities: University[];
  university?: University;
  departments: School[];
  department?: School;
  programmes: Programme[];
  uniId: string;
  setUniId: (id: string) => void;
  schoolId: string;
  setSchoolId: (id: string) => void;
  progId: string;
  setProgId: (id: string) => void;
  onContinue: () => void;
}) {
  const { appearance, onPlay, universities, university, departments, department, programmes } = props;
  const logo = appLogoImage(appearance);
  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-gradient-to-b from-brand-900 via-brand-800 to-brand-600 px-4 py-6 text-center">
      {/* Play again — top-right, exactly where it sits in the real app */}
      {onPlay && (
        <button
          onClick={onPlay}
          title="Play Sky Dash mini-game again"
          className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25"
        >
          🎮 Play
        </button>
      )}

      <div className="mx-auto mt-8 w-full max-w-sm">
        {logo ? (
          <img src={logo} alt={appName(appearance)} className="mx-auto h-20 w-20 object-contain drop-shadow-xl" />
        ) : (
          <span className="mx-auto grid h-20 w-20 place-items-center drop-shadow-xl">
            <AppGlyph appearance={appearance} slot="appIcon" fallback="🧭" size={48} />
          </span>
        )}
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white drop-shadow">
          {appName(appearance)}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/90">Select your university, school and programme.</p>

        <LogoStrip university={university} department={department} />

        <div className="mt-4 rounded-3xl bg-white/10 p-4 backdrop-blur-md ring-1 ring-white/20">
          <Field label="University" dark>
            <select className="w-full bg-transparent outline-none" value={props.uniId} onChange={(e) => props.setUniId(e.target.value)}>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Department" dark>
            <select className="w-full bg-transparent outline-none" value={props.schoolId} onChange={(e) => props.setSchoolId(e.target.value)}>
              {departments.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Programme" dark>
            <select className="w-full bg-transparent outline-none" value={props.progId} onChange={(e) => props.setProgId(e.target.value)}>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.shortName || p.name}</option>
              ))}
            </select>
          </Field>
          <button
            onClick={props.onContinue}
            className="mt-4 w-full rounded-2xl bg-white px-5 py-3 text-sm font-black text-brand-800 transition hover:bg-brand-50 active:scale-[0.98]"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, dark, children }: { label: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-left">
      <span className={`mb-1 mt-3 block text-[10px] font-bold uppercase tracking-wide ${dark ? 'text-white/60' : 'text-slate-400'}`}>
        {label}
      </span>
      <div className="w-full rounded-xl border border-white/20 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none">
        {children}
      </div>
    </label>
  );
}

/** Institution + department logos shown directly under the caption. */
function LogoStrip({ university, department }: { university?: University; department?: School }) {
  const items: { src?: string; emoji: string; name: string }[] = [];
  if (university) items.push({ src: university.logo, emoji: '🏛️', name: university.shortName || university.name });
  if (department) items.push({ src: department.logo, emoji: '🏢', name: department.name });
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-start justify-center gap-3">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          {it.src ? (
            <img src={it.src} alt={`${it.name} logo`} className="h-11 w-11 rounded-xl bg-white object-contain p-0.5 shadow ring-1 ring-white/30" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-xl ring-1 ring-white/20">{it.emoji}</span>
          )}
          <span className="max-w-[90px] truncate text-[9px] font-bold text-white/80">{it.name}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Mode selection (mirrors the real Quick/History picker) ────────────── */

function ModeScreen({ appearance, onPick }: { appearance?: AppAppearance; onPick: (m: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-brand-50 to-white px-6 text-center">
      <h2 className="text-xl font-black text-slate-800">How do you want to start?</h2>
      <p className="mt-1 text-xs text-slate-500">You can change this later at any time.</p>
      <div className="mt-5 w-full space-y-3">
        <button onClick={() => onPick('quick')} className="w-full rounded-2xl bg-brand-600 px-5 py-4 text-left text-base font-black text-white shadow-lg transition hover:bg-brand-700 active:scale-[0.98]">
          <span className="inline-flex items-center gap-2">
            <AppGlyph appearance={appearance} slot="quickmode" fallback="⚡" size={20} />
            Quick Mode
          </span>
          <span className="block text-xs font-medium opacity-90">Current level + CGPA to begin</span>
        </button>
        <button onClick={() => onPick('history')} className="w-full rounded-2xl bg-white px-5 py-4 text-left text-base font-black text-brand-600 ring-1 ring-brand-200 shadow-sm transition hover:bg-brand-50 active:scale-[0.98]">
          <span className="inline-flex items-center gap-2">CGPA History</span>
          <span className="block text-xs font-medium opacity-80">Enter each level for advance planning</span>
        </button>
      </div>
    </div>
  );
}

/* ── Home hub (mirrors the real student home) ─────────────────────────── */

function HomeScreen(props: {
  appearance?: AppAppearance;
  institutionLabel: string;
  published: boolean;
  hasData: boolean;
  mode: string | null;
  tool: ToolId | null;
  setTool: (t: ToolId) => void;
  onBackHome: () => void;
  whatIfAllowed: boolean;
}) {
  const { appearance, institutionLabel, published, hasData, tool, setTool, onBackHome, whatIfAllowed } = props;
  const logo = appLogoImage(appearance);
  const [privacy, setPrivacy] = useState(false);
  const visibleToolOrder = TOOL_ORDER.filter((t) => t !== 'whatif' || whatIfAllowed);

  // A tool is open → show the app's tool frame (header + content + Prev/Next).
  if (tool)
    return (
      <ToolFrame
        appearance={appearance}
        tool={tool}
        onBackHome={onBackHome}
        onNavigate={(t) => setTool(t)}
        whatIfAllowed={whatIfAllowed}
      />
    );

  // Privacy screen (mirrors the real student Privacy view top).
  if (privacy)
    return (
      <div className="flex h-full flex-col bg-slate-50">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2.5">
          <button
            onClick={() => setPrivacy(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-slate-200 active:scale-95"
            aria-label="Back"
          >
            ←
          </button>
          <h1 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              <AppGlyph appearance={appearance} slot="privacy" fallback="🔒" size={16} />
            </span>
            Privacy
          </h1>
        </header>
        <div className="app-frame flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-md space-y-2 rounded-2xl bg-white p-4 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
            <p className="text-sm font-black text-slate-800">Your privacy by design</p>
            <p>No account. No sign-up. Nothing you type is saved, uploaded or shared.</p>
            <p>Everything stays on this device and can be cleared anytime with the Refresh/Clear button.</p>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-brand-50 to-white">
      <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2.5">
          {logo ? (
            <img src={logo} alt="logo" className="h-9 w-9 rounded-xl object-contain shadow-sm ring-1 ring-slate-200" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">
              <AppGlyph appearance={appearance} slot="appIcon" fallback="🧭" size={20} />
            </span>
          )}
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-slate-900">{appName(appearance)}</p>
            <p className="text-[9px] font-semibold italic text-slate-400">{tagline(appearance)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Pill label="🔁" title="Refresh / clear (on the real app)" />
          <Pill label="🗑" title="Refresh / clear (on the real app)" />
        </div>
      </header>

      <div className="app-frame flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="mx-auto w-full max-w-md">
          {/* Hero — fresh student (no results yet) */}
          <section className="mt-1 rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-900 p-5 text-center text-white shadow-xl ring-1 ring-white/10">
            <p className="flex items-center justify-center text-3xl">
              {/* Mirrors the real hero: fixed slot, enlarged plane overflows */}
              <span className="grid h-9 w-14 place-items-center">
                <AppGlyph appearance={appearance} slot="plane" fallback="✈️" size={34} />
              </span>
            </p>
            <h2 className="mt-2 text-lg font-black">Let’s get you off the ground</h2>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-100">
              Start in <strong className="text-white">My results</strong> and enter your
              current level + CGPA. Every tool below then works from that one number —
              nothing is saved or shared.
            </p>
            <button
              onClick={() => setTool('calculate')}
              className="mt-4 rounded-2xl bg-white px-6 py-3 text-sm font-black text-brand-700 shadow-lg active:scale-[0.98]"
            >
              📝 Enter my results
            </button>
          </section>

          <p className="mt-5 mb-2 px-1 text-[11px] font-black uppercase tracking-[0.15em] text-slate-400">Tools</p>
          <div className="space-y-2.5">
            {visibleToolOrder.map((id) => {
              const m = TOOL_META[id];
              const disabled = m.needsData && !hasData;
              return (
                <button
                  key={id}
                  onClick={() => !disabled && setTool(id as ToolId)}
                  disabled={disabled}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition ${
                    disabled ? 'bg-slate-100 opacity-70 ring-slate-200' : 'bg-white shadow-sm ring-slate-200 active:scale-[0.99]'
                  }`}
                >
                  {/* Mirrors the real tile: fixed-size slot, an admin-enlarged
                      image overflows it without moving the tile. */}
                  <span className="grid h-9 w-9 shrink-0 place-items-center text-2xl leading-none">
                    <AppGlyph appearance={appearance} slot={id} fallback={m.emoji} size={24} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-extrabold text-slate-900">{m.title}</span>
                    <span className="block truncate text-xs text-slate-500">{m.tagline}</span>
                  </span>
                  {disabled ? (
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-[9px] font-bold text-slate-500">add results first</span>
                  ) : (
                    <span className="shrink-0 text-slate-300">›</span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setPrivacy(true)}
            className="mt-5 flex w-full items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-left ring-1 ring-emerald-200"
          >
            <span className="flex h-6 w-6 items-center justify-center">
              <AppGlyph appearance={appearance} slot="privacy" fallback="🔒" size={18} />
            </span>
            <span className="flex-1 text-xs font-bold text-emerald-800">
              No account. Nothing you type is saved or shared — see how.
            </span>
            <span className="text-emerald-400">›</span>
          </button>
          {!published && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
              ⏳ Awaiting published curriculum — no PUBLISHED version exists for this programme yet.
            </p>
          )}
          <p className="mt-4 text-center text-[9px] text-slate-400">{institutionLabel}</p>
        </div>
      </div>
    </div>
  );
}

/* ── A tool's screen: header + content + bottom Prev/Next/Home nav ────── */

function ToolFrame({
  appearance,
  tool,
  onBackHome,
  onNavigate,
  whatIfAllowed,
}: {
  appearance?: AppAppearance;
  tool: ToolId;
  onBackHome: () => void;
  onNavigate: (t: ToolId) => void;
  whatIfAllowed: boolean;
}) {
  const m = TOOL_META[tool];
  const order = TOOL_ORDER.filter((t) => t !== 'whatif' || whatIfAllowed);
  const idx = order.indexOf(tool);
  const prev: ToolId | null = idx > 0 ? (order[idx - 1] as ToolId) : null;
  const next: ToolId | null = idx < order.length - 1 ? (order[idx + 1] as ToolId) : null;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur">
        <button
          onClick={onBackHome}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-slate-200 active:scale-95"
          aria-label="Back to home"
        >
          ←
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-extrabold text-slate-900">
          <span className="grid h-5 w-5 shrink-0 place-items-center">
            <AppGlyph appearance={appearance} slot={tool} fallback={m.emoji} size={18} />
          </span>
          <span className="truncate">{m.title}</span>
        </h1>
        <div className="flex shrink-0 items-center gap-1.5">
          <Pill label="🔁" title="Refresh (on the real app)" />
          <Pill label="🗑" title="Clear (on the real app)" />
        </div>
      </header>

      {/* content */}
      <div className="app-frame flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div className="mx-auto w-full max-w-md">
          {m.needsData ? (
            <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
              {/* Fixed slot: an admin-enlarged icon overflows the card's rhythm */}
              <span className="mx-auto grid h-10 w-10 place-items-center">
                <AppGlyph appearance={appearance} slot={tool} fallback={m.emoji} size={40} />
              </span>
              <p className="mt-3 text-sm font-bold text-slate-700">{m.title}</p>
              <p className="mt-1 text-xs text-slate-500">{m.tagline}</p>
              <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100">
                Add your results in “My results” first — this tool then works from that one number.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <p className="text-sm font-black text-slate-800">My results &amp; standing</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Here a student enters their current level and CGPA (Quick Mode) or
                each completed level’s GPA (CGPA History). The confirmed CGPA,
                classification and every other tool are then computed live from the
                published rules.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* bottom Prev / Home / Next nav — identical to the real app */}
      <nav className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          {prev ? (
            <button
              onClick={() => onNavigate(prev)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 py-2 text-left text-brand-700 transition active:scale-95"
            >
              <span className="text-lg leading-none">‹</span>
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">Prev</span>
                <span className="block truncate text-xs font-black">{TOOL_META[prev].title}</span>
              </span>
            </button>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <button
            onClick={onBackHome}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-indigo-700 text-lg text-white shadow active:scale-95"
            title="Home"
          >
            🏠
          </button>
          {next ? (
            <button
              onClick={() => onNavigate(next)}
              className="flex min-w-0 flex-1 items-center justify-end gap-1.5 rounded-xl px-2 py-2 text-right text-brand-700 transition active:scale-95"
            >
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">Next</span>
                <span className="block truncate text-xs font-black">{TOOL_META[next].title}</span>
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

function Pill({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-xl bg-slate-100 text-sm text-slate-400 ring-1 ring-slate-200"
    >
      {label}
    </span>
  );
}
