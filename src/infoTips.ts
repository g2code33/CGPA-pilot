// ─────────────────────────────────────────────────────────────────────────
// ideaTips — the small 💡 "idea icons" next to the calculated result boxes.
//
// SINGLE SOURCE OF TRUTH for what each icon explains:
//   • student views resolve their live sentence through ideaTip()
//   • the admin console edits the same registry (toggle off + rewording)
//
// Admin choices ride the published config as `settings.ideaTips`
// (see config/types.ts) — non-personal, ships offline, identical on every
// student device. This module is DOM-free so it can be unit-tested directly.
// ─────────────────────────────────────────────────────────────────────────

import type { StudentSettings } from './config/types';
import { getRuntimeCatalog } from './config/runtime';

/** One idea icon: where it lives + the sentence it shows by default. */
export interface IdeaTip {
  /** Stable key stored in the admin catalog (settings.ideaTips.texts). */
  key: string;
  /** Student page the icon lives on (used to group the admin editor). */
  page: string;
  /** What the icon sits next to (the number/label it explains). */
  subject: string;
  /** Built-in sentence shown when the admin has not reworded it. */
  text: string;
}

export const IDEA_TIPS: IdeaTip[] = [
  // ── Target ────────────────────────────────────────────────────────────
  { key: 'target.currentCgpa', page: 'Target', subject: 'Current CGPA', text: 'Your confirmed CGPA so far. It is the starting point of everything here.' },
  { key: 'target.target', page: 'Target', subject: 'Target', text: 'The CGPA you want to finish with. It is a goal you set, not a prediction.' },
  { key: 'target.whatYouNeed', page: 'Target', subject: 'What you need', text: 'The average you must keep from now until graduation to reach your target.' },
  { key: 'target.bestPossible', page: 'Target', subject: 'Best possible final CGPA', text: 'The highest CGPA you can still get — top grade in every credit you still have.' },
  { key: 'target.creditsCompleted', page: 'Target', subject: 'Credits completed', text: 'Credits you have finished and that count in your CGPA right now.' },
  { key: 'target.creditsRemaining', page: 'Target', subject: 'Credits remaining', text: 'Credits still to go before you graduate.' },
  // ── Finish this semester ───────────────────────────────────────────────
  { key: 'next.confirmed', page: 'Finish this semester', subject: 'Confirmed credits', text: 'Credits already inside your confirmed CGPA.' },
  { key: 'next.semester', page: 'Finish this semester', subject: 'This semester', text: 'The credits in the semester this plan works on.' },
  { key: 'next.after', page: 'Finish this semester', subject: 'After that', text: 'Credits in the semesters that come after this one.' },
  // ── What-If ────────────────────────────────────────────────────────────
  { key: 'whatif.credits', page: 'What-If', subject: 'This semester credits', text: 'The credits this “what-if” average applies to.' },
  { key: 'whatif.remaining', page: 'What-If', subject: 'Remaining to graduation', text: 'All credits still ahead, including this one. Your projected final CGPA is divided by this number.' },
  // ── Flight Path ────────────────────────────────────────────────────────
  { key: 'flight.current', page: 'Flight Path', subject: 'Current CGPA', text: 'Where you are right now — your confirmed CGPA.' },
  { key: 'flight.target', page: 'Flight Path', subject: 'Target CGPA', text: 'The CGPA you aim to finish with (your goal).' },
  { key: 'flight.required', page: 'Flight Path', subject: 'Required future GPA', text: 'The steady average you must keep from now to hit your target.' },
  { key: 'flight.projected', page: 'Flight Path', subject: 'Projected at graduation', text: 'The CGPA you land on if you keep your current average. The line under it is the class you would get.' },
  // ── Milestones ─────────────────────────────────────────────────────────
  { key: 'milestones.projectedAfter', page: 'Milestones', subject: 'Projected CGPA after', text: 'Your CGPA after this stage, if you keep the scenario average.' },
  { key: 'milestones.requiredAfter', page: 'Milestones', subject: 'Required future GPA', text: 'The average you must keep after this stage to still reach your target.' },
  { key: 'milestones.bestAfter', page: 'Milestones', subject: 'Best possible after', text: 'The highest CGPA still possible after this stage — top grades in everything left.' },
  { key: 'milestones.creditsAhead', page: 'Milestones', subject: 'Credits still ahead', text: 'Credits left after this stage.' },
  { key: 'milestones.best', page: 'Milestones', subject: 'Best case', text: 'You get the top grade in every credit you still have.' },
  { key: 'milestones.target', page: 'Milestones', subject: 'Target case', text: 'You keep the steady average needed to hit your target.' },
  { key: 'milestones.user', page: 'Milestones', subject: 'User scenario', text: 'The GPA you set on the slider — a possible dip, for planning only.' },
];

/** Pages in display order (used to group the admin editor). */
export const IDEA_TIP_PAGES: string[] = [...new Set(IDEA_TIPS.map((t) => t.page))];

const TIP_BY_KEY: ReadonlyMap<string, IdeaTip> = new Map(IDEA_TIPS.map((t) => [t.key, t]));

/** Master switch: absent = ON; only an explicit `false` hides every idea icon. */
export function ideaTipsEnabled(settings: StudentSettings | null | undefined): boolean {
  return settings?.ideaTips?.enabled !== false;
}

/**
 * The sentence a student should see for an idea icon — or `undefined` when
 * the icon should not render at all (master switch off, or the admin
 * cleared this specific sentence).
 */
export function ideaTipText(
  settings: StudentSettings | null | undefined,
  key: string
): string | undefined {
  const tip = TIP_BY_KEY.get(key);
  if (!tip) return undefined;
  if (!ideaTipsEnabled(settings)) return undefined;
  const custom = settings?.ideaTips?.texts?.[key];
  if (custom !== undefined && custom.trim() === '') return undefined; // cleared → hide this icon
  return custom && custom.trim() !== '' ? custom : tip.text;
}

/** Convenience for student views: resolves a sentence from the running catalog. */
export function ideaTip(key: string): string | undefined {
  return ideaTipText(getRuntimeCatalog().settings, key);
}
