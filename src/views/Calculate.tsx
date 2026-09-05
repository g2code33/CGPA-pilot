import { useMemo, useState, type ReactNode } from 'react';
import { useDerived } from '../state/derived';
import { Card, Info, SectionTitle } from '../components/ui';
import { permissionOn } from '../permissions';
import { ideaTip } from '../infoTips';
import { PendingProjectionPanel } from '../components/PendingProjection';
import { validateGpa } from '../services/gradingService';
import { curriculumSemesterCourses } from '../services/structureService';
import type { HistoryJourney } from '../services/historyProgress';
import { fmt2 } from '../util/format';

type StandingStatus = 'released' | 'notReleased' | 'justStarted';

const STATUS_OPTIONS: { id: StandingStatus; label: string; active: string }[] = [
  { id: 'released', label: 'Released', active: 'bg-emerald-600 text-white ring-emerald-600' },
  { id: 'notReleased', label: 'Not released', active: 'bg-amber-500 text-white ring-amber-500' },
  { id: 'justStarted', label: 'Just started', active: 'bg-brand-600 text-white ring-brand-600' },
];

/** Plain (unselected) → coloured (selected) segmented status pills. */
function StatusPicker({
  value,
  onChange,
}: {
  value: StandingStatus;
  onChange: (s: StandingStatus) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
      {STATUS_OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`rounded-lg px-2 py-2 text-center text-xs font-bold transition ${
              active ? `${o.active} shadow` : 'bg-slate-100 text-slate-600 hover:bg-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface SemCourseLike {
  id: string;
  code: string;
  name: string;
  creditHours: number;
}

/**
 * Shared smart picker: lists the admin-configured courses for the selected
 * semester so the user can mark which results are "not released". Also offers
 * Select all / Clear. Credits are summed automatically by the caller.
 */
function AdvancedCoursePanel({
  level,
  sem,
  courses,
  taggedIds,
  onTagged,
}: {
  level: number;
  sem: number;
  courses: SemCourseLike[];
  taggedIds: string[];
  onTagged: (ids: string[]) => void;
}) {
  const tagged = new Set(taggedIds);
  const sum = courses
    .filter((c) => tagged.has(c.id))
    .reduce((s, c) => s + (c.creditHours || 0), 0);
  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">
          Which {level * 100} · Sem {sem} courses are{' '}
          <span className="text-amber-600">not released</span>?
        </p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => onTagged(courses.map((c) => c.id))}
            className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200 active:scale-95"
          >
            Select all
          </button>
          {taggedIds.length > 0 && (
            <button
              type="button"
              onClick={() => onTagged([])}
              className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 active:scale-95"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {courses.map((c) => (
          <CourseTag
            key={c.id}
            code={c.code}
            name={c.name}
            credits={c.creditHours}
            active={tagged.has(c.id)}
            onToggle={() => {
              const next = new Set(tagged);
              if (next.has(c.id)) next.delete(c.id);
              else next.add(c.id);
              onTagged([...next]);
            }}
          />
        ))}
      </div>
      <p className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        {sum > 0 ? (
          <>
            <strong className="text-amber-600">{sum} credits</strong> marked not
            released — excluded from your confirmed CGPA and shown as a projection until
            they land.
          </>
        ) : (
          'Tap a course (or Select all) if its result isn’t out yet.'
        )}
      </p>
    </div>
  );
}

/** One tap-to-select curriculum course (marks it as "result not released"). */
function CourseTag({
  code,
  name,
  credits,
  active,
  onToggle,
}: {
  code: string;
  name: string;
  credits: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
        active ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300' : 'border-slate-200 bg-white'
      }`}
    >
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${
          active ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {active ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-slate-800">{code}</span>
        <span className="block truncate text-[11px] text-slate-500">{name}</span>
      </span>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
        {credits} cr
      </span>
    </button>
  );
}

export function Calculate({ onProceed }: { onProceed?: () => void }) {
  const d = useDerived();
  const { state, dispatch, record } = d;
  // Screen help sentence — registry-driven (admin can reword or hide it).
  const modeHelp = ideaTip('calc.modeHelp');
  // A CGPA is "entered" when the user has typed one (Quick/planning = current
  // standing CGPA; History = at least one completed level's CGPA).
  const hasCgpa =
    state.mode === 'history'
      ? state.semesters.some((s) => s.gpa !== null)
      : state.baseline.cgpa !== null;

  // GPA-History completeness: the record only counts when EVERY level below
  // the current one (and the current one, if its results are released) has a
  // CGPA entered. A partial history must never yield a number or a proceed.
  const journey = d.historyJourney;
  const historyIncomplete =
    state.mode === 'history' && !!journey && !journey.complete;
  const canProceed = hasCgpa && !historyIncomplete;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {modeHelp && <Info label="How to use / what this means">{modeHelp}</Info>}
        <p className="text-[11px] font-bold text-slate-500">
          {state.inputMode === 'quick' ? 'Quick mode' : 'CGPA History'}
        </p>
        <button
          onClick={() => dispatch({ type: 'setInputMode', inputMode: state.inputMode === 'quick' ? 'history' : 'quick' })}
          className="ml-auto rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200 active:scale-95"
        >
          {state.inputMode === 'quick' ? 'Switch to History' : 'Switch to Quick'}
        </button>
      </div>

      {state.inputMode === 'planning' ? (
        <Mode />
      ) : state.inputMode === 'quick' ? (
        <CurrentStanding />
      ) : (
        <HistoryMode />
      )}

      {d.pending.pendingCreditHours > 0 && (
        <PendingProjectionPanel pending={d.pending} target={state.targetCgpa} />
      )}

      {/* GPA-History completeness guard — a partial history must NOT produce
          a CGPA. Tell the student exactly which levels to go back and complete. */}
      {historyIncomplete && journey && (
        <Card className="border-2 border-red-300 bg-red-50">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-xl">⚠️</span>
            <div>
              <p className="text-sm font-black text-red-800">
                Your CGPA history is incomplete — go back and complete it
              </p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-red-700">
                You are in <b>Level {state.baseline.levelIndex * 100}</b>, but these levels have no
                CGPA entered:{' '}
                <b>{journey.missingRequired.map((lv) => `Level ${lv * 100}`).join(', ')}</b>.
                CGPA History tracks your journey from Level 100, so the app will not compute or
                confirm a CGPA from partial data. Enter each missing level above, then continue.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="bg-slate-900 text-white ring-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              {historyIncomplete ? 'CGPA — incomplete history' : 'Confirmed CGPA'}
            </p>
            <p className="text-4xl font-black tabular-nums">
              {historyIncomplete ? '—' : fmt2(record.cgpa)}
            </p>
          </div>
          <div className="text-right text-xs text-slate-300">
            {historyIncomplete ? (
              <>
                <p className="font-bold text-amber-300">
                  {journey?.missingRequired.length} level
                  {journey?.missingRequired.length === 1 ? '' : 's'} missing
                </p>
                <p className="mt-0.5">complete it to see your CGPA</p>
              </>
            ) : (
              <>
                <p>{record.creditHours} graded credits</p>
                {record.pendingCount > 0 && (
                  <p className="text-amber-300">⏳ {d.pending.pendingCreditHours} cr not released</p>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Proceed — plain & disabled until a CGPA exists, then coloured & enabled */}
      <button
        onClick={() => canProceed && onProceed?.()}
        disabled={!canProceed}
        className={`w-full rounded-2xl px-6 py-4 text-base font-black transition active:scale-[0.99] ${
          canProceed
            ? 'bg-brand-600 text-white shadow-lg hover:bg-brand-700'
            : 'cursor-not-allowed bg-slate-200 text-slate-400 ring-1 ring-slate-300'
        }`}
      >
        {historyIncomplete
          ? `Complete ${journey?.missingRequired.length} missing level${
              journey?.missingRequired.length === 1 ? '' : 's'
            } to continue`
          : canProceed
            ? 'Proceed to Tools →'
            : 'Enter your CGPA to continue'}
      </button>
    </div>
  );
}

/** Shared “where am I now” card: current level + semester + status pills. */
function StandingEditor({
  title,
  subtitle,
  info,
  status,
  onStatus,
  onChanged,
}: {
  title: string;
  subtitle?: string;
  info?: ReactNode;
  status: StandingStatus;
  onStatus: (s: StandingStatus) => void;
  onChanged?: () => void;
}) {
  const d = useDerived();
  const { state, dispatch } = d;
  const b = state.baseline;
  const levels =
    d.slots.length > 0
      ? Array.from(new Set(d.slots.map((s) => s.levelIndex))).sort((a, z) => a - z)
      : [1, 2, 3, 4, 5, 6];

  return (
    <Card>
      <SectionTitle title={title} subtitle={subtitle} info={info} />
      <div className="rounded-2xl bg-slate-50/70 p-3 ring-1 ring-slate-200">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Current level</span>
            <select
              className="input w-full"
              value={b.levelIndex}
              onChange={(e) => {
                const lv = Number(e.target.value);
                dispatch({ type: 'setBaseline', patch: { levelIndex: lv, semesterIndex: 1 } });
                onChanged?.();
              }}
            >
              {levels.map((lv) => (
                <option key={lv} value={lv}>
                  Level {lv * 100}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Current semester</span>
            <select
              className="input w-full"
              value={b.semesterIndex}
              onChange={(e) => {
                dispatch({ type: 'setBaseline', patch: { semesterIndex: Number(e.target.value) } });
                onChanged?.();
              }}
            >
              <option value={1}>First</option>
              <option value={2}>Second</option>
            </select>
          </label>
        </div>
        <div className="mt-2">
          <span className="label">Status?</span>
          <StatusPicker value={status} onChange={onStatus} />
        </div>
      </div>
    </Card>
  );
}

/** Quick mode: one standing + smart “not released” course tagging + Proceed. */
function CurrentStanding() {
  const d = useDerived();
  const { state, dispatch, grading, progress, curriculumPublished } = d;
  const b = state.baseline;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const cgpaError = validateGpa(b.cgpa, grading);
  const creditsKnown = progress.hasCreditData && progress.completedCredits > 0;

  const status: StandingStatus = b.standing ?? 'released';

  // Admin-configured courses for the currently selected semester.
  const semCourses = curriculumSemesterCourses(d.curriculum, b.levelIndex, b.semesterIndex);
  const pendingIds = b.pendingCourseIds ?? [];
  const tagged = useMemo(() => new Set(pendingIds), [pendingIds]);
  const hasSemCourses = semCourses.length > 0;
  const pendingSum = semCourses
    .filter((c) => tagged.has(c.id))
    .reduce((s, c) => s + (c.creditHours || 0), 0);

  // Map a chosen standing onto the engine flags.
  function applyStanding(s: StandingStatus) {
    setShowAdvanced(false);
    if (s === 'released') {
      dispatch({ type: 'setBaseline', patch: { standing: 'released', justEntered: false, pendingCreditHours: 0, pendingCourseIds: [] } });
    } else if (s === 'notReleased') {
      // Entire current semester not released → base on the immediate past semester.
      dispatch({ type: 'setBaseline', patch: { standing: 'notReleased', justEntered: true, pendingCreditHours: 0, pendingCourseIds: [] } });
    } else {
      dispatch({ type: 'setBaseline', patch: { standing: 'justStarted', justEntered: true, pendingCreditHours: 0, pendingCourseIds: [] } });
    }
  }

  // Smart per-course tagging → engine auto-derives the pending credits.
  function setTagged(next: Set<string>) {
    const sum = semCourses
      .filter((c) => next.has(c.id))
      .reduce((s, c) => s + (c.creditHours || 0), 0);
    dispatch({
      type: 'setBaseline',
      patch: {
        standing: 'released',
        justEntered: false,
        pendingCourseIds: [...next],
        pendingCreditHours: sum,
      },
    });
  }

  // Standing explanation — registry-driven (admin can reword or hide each
  // variant); the right variant is picked by the current standing.
  const infoText = ideaTip(
    status === 'released'
      ? 'calc.standing.released'
      : status === 'notReleased'
        ? 'calc.standing.notReleased'
        : 'calc.standing.justStarted'
  );
  // Advanced help sentence — registry-driven (admin can reword or hide it).
  const advancedTip = ideaTip('calc.advanced.quick');

  return (
    <div className="space-y-3">
      <StandingEditor
        title="Your standing"
        status={status}
        onStatus={applyStanding}
        onChanged={() => setTagged(new Set())}
        info={infoText}
      />

      <Card>
        <SectionTitle
          title="Your current CGPA"
          subtitle={
            status === 'released'
              ? 'Over your released results so far.'
              : 'From your immediate past semester.'
          }
          info={ideaTip(status === 'released' ? 'calc.currentCgpa.released' : 'calc.currentCgpa.past')}
        />
        <label className="block">
          <span className="label">Current CGPA</span>
          <input
            type="number"
            min={0}
            max={d.maxPoints}
            step={0.01}
            className={`input text-center text-lg font-black ${
              cgpaError ? 'ring-2 ring-red-300 focus:ring-red-400' : ''
            }`}
            placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
            value={b.cgpa ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) },
              })
            }
          />
          {cgpaError && (
            <span className="mt-1 block text-center text-xs font-semibold text-red-600">{cgpaError}</span>
          )}
        </label>

        {/* Reactive: which credits this typed CGPA is understood to cover. This
            prevents the typed number from being silently reinterpreted when the
            standing changes (e.g. Released → Not released drops the current
            semester out of the confirmed base). */}
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
          {status === 'released' ? (
            <>
              The CGPA you type is taken over your <strong>released results to
              date</strong> — through Level {d.confirmedPosition.levelIndex * 100} · Semester{' '}
              {d.confirmedPosition.semesterIndex} ({d.progress.completedCredits} confirmed credits).
            </>
          ) : (
            <>
              Because this semester isn’t confirmed yet, the CGPA you type is understood
              to be your average over your <strong>confirmed results so far</strong> —
              through Level {d.confirmedPosition.levelIndex * 100} · Semester{' '}
              {d.confirmedPosition.semesterIndex} ({d.progress.completedCredits} confirmed
              credits). If you enter a CGPA for the whole semester here, switch the
              standing to <strong>Released</strong> first so its credits count.
            </>
          )}
        </p>

        {/* Single Advanced control — shown when the standing is Released */}
        {status === 'released' && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className={`rounded-full px-4 py-2 text-xs font-bold ring-1 transition ${
                  pendingIds.length > 0
                    ? 'bg-amber-500 text-white ring-amber-500'
                    : showAdvanced
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-300'
                }`}
              >
                {pendingIds.length > 0
                  ? `⚙️ Advanced · ${pendingSum} cr not released`
                  : '⚙️ Advanced'}
              </button>
              {advancedTip && <Info label="When to use Advanced">{advancedTip}</Info>}
            </div>

            {showAdvanced && (
              <div className="mt-3">
                {hasSemCourses ? (
                  <AdvancedCoursePanel
                    level={b.levelIndex}
                    sem={b.semesterIndex}
                    courses={semCourses}
                    taggedIds={pendingIds}
                    onTagged={(ids) => setTagged(new Set(ids))}
                  />
                ) : (
                  <label className="block rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <span className="label">Results not released (credits)</span>
                    {permissionOn('allowCreditEditing') ? (
                      <input
                        type="number"
                        min={0}
                        className="input text-center text-lg font-black"
                        placeholder="e.g. 6"
                        value={b.pendingCreditHours ? String(b.pendingCreditHours) : ''}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          dispatch({
                            type: 'setBaseline',
                            patch: { pendingCreditHours: v, pendingCourseIds: [] },
                          });
                        }}
                      />
                    ) : (
                      <p className="rounded-xl bg-white px-3 py-2 text-center text-lg font-black text-slate-700 ring-1 ring-slate-200">
                        {b.pendingCreditHours || 0}{' '}
                        <span className="align-middle text-[9px] font-bold text-brand-600">🔒 locked</span>
                      </p>
                    )}
                    <span className="mt-1 block text-[10px] text-slate-400">
                      {permissionOn('allowCreditEditing')
                        ? 'The admin hasn’t published this semester’s courses yet, so enter the total credits whose results are pending.'
                        : '🔒 Credit editing is switched off by your administrator, so this credit count is locked.'}
                    </span>
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {status !== 'released' && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
            {status === 'justStarted' ? (
              <>
                Your confirmed CGPA is based on the semester you just finished. The
                planning tools now target <strong>finishing this semester</strong> —
                write its exams at the end, then come back and set this to{' '}
                <strong>Released</strong> to add those results.
              </>
            ) : (
              <>
                Your confirmed CGPA is based on the semester you just finished. The tools
                show what your results will be <strong>on release</strong> — when the
                marks come out, confirm them by setting this to <strong>Released</strong>.
              </>
            )}
          </p>
        )}

        {creditsKnown && status === 'released' && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
              <p className="font-black text-slate-800">{progress.completedCredits}</p>
              <p className="text-slate-500">credits completed</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
              <p className="font-black text-brand-700">{progress.remainingCredits}</p>
              <p className="text-slate-500">credits remaining</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
              <p className="font-black text-slate-800">{progress.remainingSlots.length}</p>
              <p className="text-slate-500">semesters to go</p>
            </div>
          </div>
        )}

        {curriculumPublished ? (
          <p className="mt-3 rounded-xl bg-brand-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-brand-100">
            Credit structure and trajectory come from the {d.programme?.shortName ?? 'PharmD'}{' '}
            curriculum. Course grades are never required or inferred.
          </p>
        ) : (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
            The curriculum isn’t published yet — your level and CGPA still work; the
            administrator supplies real credit structure.
          </p>
        )}
      </Card>
    </div>
  );
}

/** CGPA History mode: per-level confirmed CGPA + the same status picker. */
function HistoryMode() {
  const d = useDerived();
  const { state, dispatch } = d;
  const b = state.baseline;
  const [manualCgpa, setManualCgpa] = useState<Record<number, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const status: StandingStatus = b.standing ?? 'released';
  function applyStanding(s: StandingStatus) {
    setShowAdvanced(false);
    if (s === 'released')
      dispatch({ type: 'setBaseline', patch: { standing: 'released', justEntered: false } });
    else
      dispatch({ type: 'setBaseline', patch: { standing: s, justEntered: true } });
  }

  const levels: number[] = (d.slots.length > 0
    ? Array.from(new Set(d.slots.map((s) => s.levelIndex))).sort(
        (a, z) => (a as number) - (z as number)
      )
    : [1, 2, 3, 4, 5, 6]
  )
    .filter((lv) => (lv as number) <= state.baseline.levelIndex)
    .map((lv) => lv as number);

  function setLevelGpa(lv: number, raw: string) {
    setManualCgpa((m) => ({ ...m, [lv]: raw }));
    const val = raw === '' ? null : Number(raw);
    if (raw === '' || Number.isNaN(val)) {
      // Clear the semester GPA if one exists.
      const existing = state.semesters.filter((s) => s.levelIndex === lv);
      existing.forEach((s) => dispatch({ type: 'setSemesterGpa', semesterId: s.id, gpa: null }));
      return;
    }
    const existing = state.semesters.find((s) => s.levelIndex === lv);
    if (existing) {
      dispatch({ type: 'setSemesterGpa', semesterId: existing.id, gpa: val });
    } else {
      dispatch({ type: 'addSemesterAt', levelIndex: lv, semesterIndex: 1 });
    }
  }

  // ── Advanced: under "Released", let the user tag specific not-released
  //    courses of the CURRENT (selected) level. These are attached to that
  //    level's history entry as pending courses so the engine excludes their
  //    credits and reports them as a projection.
  const semCourses = curriculumSemesterCourses(d.curriculum, b.levelIndex, b.semesterIndex);
  const hasSemCourses = semCourses.length > 0;
  const currentLevelSemester = state.semesters.find((s) => s.levelIndex === b.levelIndex);
  const curPendingIds = (currentLevelSemester?.courses ?? [])
    .filter((c) => c.id.startsWith('cfg-pend-'))
    .map((c) => c.id.slice('cfg-pend-'.length));
  const pendingSum = semCourses
    .filter((c) => curPendingIds.includes(c.id))
    .reduce((s, c) => s + (c.creditHours || 0), 0);
  // Advanced help sentence — registry-driven (admin can reword or hide it).
  const advancedHistoryTip = ideaTip('calc.advanced.history');

  function setHistoryTagged(ids: string[]) {
    // Build pending CourseEntries for the chosen courses (id prefix cfg-pend-).
    const pendingEntries = semCourses
      .filter((c) => ids.includes(c.id))
      .map((c) => ({
        id: `cfg-pend-${c.id}`,
        code: c.code,
        name: c.name,
        creditHours: c.creditHours,
        score: null,
        grade: null,
        pending: true,
      }));
    // Ensure a history entry exists for the current level, then attach pending.
    const target = state.semesters.find((s) => s.levelIndex === b.levelIndex);
    if (target) {
      dispatch({
        type: 'setSemesterPendingCourses',
        semesterId: target.id,
        pending: pendingEntries,
      });
    } else if (ids.length > 0) {
      dispatch({ type: 'addSemesterAt', levelIndex: b.levelIndex, semesterIndex: b.semesterIndex });
      // apply after the entry exists (component re-renders with the entry)
    }
    // Keep baseline flags in sync for a consistent label.
    dispatch({
      type: 'setBaseline',
      patch: { standing: 'released', pendingCourseIds: ids, pendingCreditHours: pendingSum },
    });
  }

  return (
    <div className="space-y-3">
      <StandingEditor
        title="Your history"
        subtitle="Which level are you in now, and how does it stand?"
        status={status}
        onStatus={applyStanding}
        info={ideaTip('calc.history')}
      />

      <Card>
        <SectionTitle
          title="Enter CGPA per completed level"
          subtitle="Type the CGPA for each level you have finished."
        />
        <div className="space-y-2">
          {levels.map((lv) => {
            const semester = state.semesters.find((s) => s.levelIndex === lv);
            const shown = manualCgpa[lv] ?? semester?.gpa?.toString() ?? '';
            return (
              <label
                key={lv}
                className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 shadow-sm"
              >
                <span className="label">Level {lv * 100} CGPA</span>
                <input
                  type="number"
                  min={0}
                  max={d.maxPoints}
                  step={0.01}
                  className="input text-center text-lg font-black"
                  placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
                  value={shown}
                  onChange={(e) => setLevelGpa(lv, e.target.value)}
                />
              </label>
            );
          })}
        </div>

        {/* Released → Advanced: tag not-released courses of the current level */}
        {status === 'released' && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className={`rounded-full px-4 py-2 text-xs font-bold ring-1 transition ${
                  curPendingIds.length > 0
                    ? 'bg-amber-500 text-white ring-amber-500'
                    : showAdvanced
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-300'
                }`}
              >
                {curPendingIds.length > 0
                  ? `⚙️ Advanced · ${pendingSum} cr not released`
                  : '⚙️ Advanced'}
              </button>
              {advancedHistoryTip && <Info label="When to use Advanced">{advancedHistoryTip}</Info>}
            </div>
            {showAdvanced && (
              <div className="mt-3">
                {hasSemCourses ? (
                  <AdvancedCoursePanel
                    level={b.levelIndex}
                    sem={b.semesterIndex}
                    courses={semCourses}
                    taggedIds={curPendingIds}
                    onTagged={setHistoryTagged}
                  />
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-200">
                    The admin hasn’t published this level’s courses yet, so per-course
                    tagging isn’t available here yet.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* The payoff of History mode: the whole journey, Level 100 → now. */}
      {d.historyJourney && d.historyJourney.hasAny && (
        <JourneyCard journey={d.historyJourney} maxPoints={d.maxPoints} />
      )}
    </div>
  );
}

/**
 * "Your journey" — the Level 100 → current-level view that makes History
 * mode worth using: a per-level table (level CGPA, running CGPA, band), a
 * trend line, and a start→now summary. Missing levels are shown in place
 * so the student sees exactly what's left to complete.
 */
function JourneyCard({
  journey,
  maxPoints,
}: {
  journey: HistoryJourney;
  maxPoints: number;
}) {
  const { levels, trend, firstCgpa, finalCgpa, complete, missingRequired, enteredCredits } =
    journey;
  const n = levels.length;
  const trendChip =
    trend === 'up'
      ? { icon: '↑', text: 'Rising', cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200' }
      : trend === 'down'
        ? { icon: '↓', text: 'Falling', cls: 'bg-red-100 text-red-700 ring-red-200' }
        : trend === 'flat'
          ? { icon: '→', text: 'Steady', cls: 'bg-slate-100 text-slate-600 ring-slate-200' }
          : null;
  const entered = levels.filter((l) => l.cgpa !== null);
  const lastEntered = entered[entered.length - 1];

  // ── Trend chart: one point per level (entered = filled, missing = hollow) ─
  const W = 320;
  const H = 116;
  const PL = 10;
  const PR = 10;
  const PT = 12;
  const PB = 20;
  const x = (i: number) => (n <= 1 ? W / 2 : PL + (i / (n - 1)) * (W - PL - PR));
  const yMax = Math.max(maxPoints, 4);
  const y = (v: number) => PT + (1 - Math.min(1, Math.max(0, v / yMax))) * (H - PT - PB);
  const segs: string[] = [];
  for (let i = 1; i < n; i++) {
    if (levels[i - 1].cgpa !== null && levels[i].cgpa !== null) {
      segs.push(`M ${x(i - 1).toFixed(1)} ${y(levels[i - 1].cgpa!).toFixed(1)} L ${x(i).toFixed(1)} ${y(levels[i].cgpa!).toFixed(1)}`);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle
          icon="📈"
          title="Your journey"
          subtitle="Your progress from scratch — Level 100 to where you are now."
        />
        {trendChip && lastEntered && firstCgpa !== null && (
          <span
            className={`ml-auto rounded-full px-3 py-1 text-[11px] font-black ring-1 ${trendChip.cls}`}
          >
            {trendChip.icon} {trendChip.text} · {firstCgpa.toFixed(2)} →{' '}
            {lastEntered.cgpa!.toFixed(2)}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="CGPA by level, from Level 100 to your current level"
      >
        {segs.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
        {levels.map((l, i) =>
          l.cgpa !== null ? (
            <circle key={i} cx={x(i)} cy={y(l.cgpa)} r={4.5} fill="#4f46e5" stroke="#fff" strokeWidth={1.5} />
          ) : (
            <g key={i}>
              <line
                x1={x(i)}
                y1={H - PB}
                x2={x(i)}
                y2={H - PB - 14}
                stroke="#f43f5e"
                strokeWidth={1.5}
                strokeDasharray="3 2"
              />
              <circle cx={x(i)} cy={H - PB - 20} r={4} fill="none" stroke="#f43f5e" strokeWidth={1.5} />
            </g>
          )
        )}
        {levels.map((l, i) => (
          <text
            key={`t${i}`}
            x={x(i)}
            y={H - 5}
            fontSize={9}
            fontWeight={700}
            textAnchor="middle"
            fill={l.cgpa !== null ? '#0f172a' : '#f43f5e'}
          >
            {l.levelIndex * 100}
          </text>
        ))}
      </svg>

      {/* Per-level table */}
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400">
              <th className="pb-1 pr-2 font-black">Level</th>
              <th className="pb-1 pr-2 text-right font-black">Level CGPA</th>
              <th className="pb-1 pr-2 text-right font-black">Running CGPA</th>
              <th className="pb-1 text-right font-black">Band</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.levelIndex} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 font-bold text-slate-700">{l.label}</td>
                <td className="py-1.5 pr-2 text-right font-black tabular-nums text-slate-900">
                  {l.cgpa !== null ? l.cgpa.toFixed(2) : (
                    l.status === 'missing' ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">not entered</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">in progress</span>
                    )
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">
                  {l.cumulativeCgpa !== null ? l.cumulativeCgpa.toFixed(2) : '—'}
                </td>
                <td className="py-1.5 text-right font-bold text-slate-500">
                  {l.classification ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Start → now summary */}
      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600 ring-1 ring-slate-200">
        {complete && finalCgpa !== null && firstCgpa !== null ? (
          <>
            You started at <b>{firstCgpa.toFixed(2)}</b> (Level 100) and have reached{' '}
            <b>{finalCgpa.toFixed(2)}</b> running CGPA across{' '}
            <b>{entered.length} level{entered.length === 1 ? '' : 's'}</b> · {enteredCredits}{' '}
            credits. {trend === 'up' ? 'Your trajectory is climbing — keep it going.' : trend === 'down' ? 'Your trajectory is slipping — the tools below show how to turn it around.' : 'You are holding steady.'}
          </>
        ) : (
          <>
            You have entered <b>{entered.length} of {n} level{n === 1 ? '' : 's'}</b>
            {missingRequired.length > 0 && (
              <> — complete <b>{missingRequired.map((lv) => `Level ${lv * 100}`).join(', ')}</b></>
            )}{' '}
            to lock in your full journey CGPA.
          </>
        )}
      </p>
    </Card>
  );
}

function Mode() {
  const d = useDerived();
  const { state, dispatch, grading, classification, progress, record } = d;
  const [futureGpa] = useState<number>(4.0);
  const target = state.targetCgpa ?? 3.6;
  const remainingCredits =
    progress.hasCreditData && state.mode === 'current'
      ? progress.remainingCredits
      : Math.max(0, d.totalProgrammeCredits - record.creditHours);
  const required = (() => {
    if (record.cgpa === null || remainingCredits <= 0) return null;
    return (target * (record.creditHours + remainingCredits) - record.points) / remainingCredits;
  })();
  void futureGpa;
  return (
    <>
      <Card>
        <SectionTitle icon="🗺️" title="Planning" subtitle="Plan the future GPA you need to hit your target." />
        <label className="block">
          <span className="label">Current CGPA</span>
          <input
            type="number"
            min={0}
            max={d.maxPoints}
            step={0.01}
            className={`input text-center text-lg font-black ${
              validateGpa(state.baseline.cgpa, grading) ? 'ring-2 ring-red-300' : ''
            }`}
            placeholder={`0.00–${d.maxPoints.toFixed(2)}`}
            value={state.baseline.cgpa ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'setBaseline',
                patch: { cgpa: e.target.value === '' ? null : Number(e.target.value) },
              })
            }
          />
        </label>
      </Card>
      <Card
        className={
          required !== null && required <= d.maxPoints + 1e-9
            ? 'bg-emerald-50 ring-emerald-200'
            : 'bg-red-50 ring-red-200'
        }
      >
        <p className="text-sm font-bold text-slate-800">
          {required !== null && required <= 0
            ? `You'll clear ${fmt2(target)} even with a 0.00 semester.`
            : required !== null && required <= d.maxPoints + 1e-9
              ? `Reachable — average about ${fmt2(required)} over ${remainingCredits} remaining credits.`
              : 'Enter your CGPA to see what it takes to reach your target.'}
        </p>
      </Card>
    </>
  );
}
