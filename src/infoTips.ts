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
  { key: 'flight.assumeGpa', page: 'Flight Path', subject: 'Assumed future GPA', text: 'The average you expect to keep in the semesters ahead. Drag it — the projected line follows.' },
  { key: 'flight.flyRequired', page: 'Flight Path', subject: 'Fly the required line', text: 'Snaps your assumed average to the required one — the exact line you would need to fly.' },
  // ── Milestones ─────────────────────────────────────────────────────────
  { key: 'milestones.projectedAfter', page: 'Milestones', subject: 'Projected CGPA after', text: 'Your CGPA after this stage, if you keep the scenario average.' },
  { key: 'milestones.requiredAfter', page: 'Milestones', subject: 'Required future GPA', text: 'The average you must keep after this stage to still reach your target.' },
  { key: 'milestones.bestAfter', page: 'Milestones', subject: 'Best possible after', text: 'The highest CGPA still possible after this stage — top grades in everything left.' },
  { key: 'milestones.creditsAhead', page: 'Milestones', subject: 'Credits still ahead', text: 'Credits left after this stage.' },
  { key: 'milestones.best', page: 'Milestones', subject: 'Best case', text: 'You get the top grade in every credit you still have.' },
  { key: 'milestones.target', page: 'Milestones', subject: 'Target case', text: 'You keep the steady average needed to hit your target.' },
  { key: 'milestones.user', page: 'Milestones', subject: 'User scenario', text: 'The GPA you set on the slider — a possible dip, for planning only.' },
  // ── Table column tips (every table in the app) ───────────────────────
  { key: 'table.fm.milestone', page: 'Flight Path · Milestones', subject: 'Milestone', text: 'Each checkpoint on the way — now, the end of each level, and graduation.' },
  { key: 'table.fm.credits', page: 'Flight Path · Milestones', subject: 'Credits', text: 'Total credits counted at that point.' },
  { key: 'table.fm.projected', page: 'Flight Path · Milestones', subject: 'Projected CGPA', text: 'Your CGPA there if you keep your current average.' },
  { key: 'table.fm.required', page: 'Flight Path · Milestones', subject: 'Required CGPA', text: 'The CGPA you must be holding there to still reach your target.' },
  { key: 'table.fm.class', page: 'Flight Path · Milestones', subject: 'Projected class', text: 'The degree class that projected CGPA would earn.' },
  { key: 'table.ms.stage', page: 'Milestones · Stages', subject: 'Stage', text: 'A checkpoint: where you are now, the end of each level, and graduation.' },
  { key: 'table.ms.requiredGpa', page: 'Milestones · Stages', subject: 'Required GPA', text: 'The average you still need from that stage to hit your target.' },
  { key: 'table.ms.projected', page: 'Milestones · Stages', subject: 'Projected CGPA', text: 'Your CGPA there if you keep the steady planned average.' },
  { key: 'table.ms.scenario', page: 'Milestones · Stages', subject: 'Your scenario', text: 'Your CGPA there with the average you set yourself.' },
  { key: 'table.ms.target', page: 'Milestones · Stages', subject: 'Target', text: 'The CGPA you are aiming to finish with.' },
  { key: 'table.ms.max', page: 'Milestones · Stages', subject: 'Max possible', text: 'The highest CGPA still reachable from that stage — top grades in everything left.' },
  { key: 'table.ms.credits', page: 'Milestones · Stages', subject: 'Credits left', text: 'Credits still to come after that stage.' },
  { key: 'table.ns.course', page: 'Finish this semester · Courses', subject: 'Course', text: 'The courses in this semester.' },
  { key: 'table.ns.credits', page: 'Finish this semester · Courses', subject: 'Credits', text: 'How many credits the course carries.' },
  { key: 'table.ns.grade', page: 'Finish this semester · Courses', subject: 'Target grade', text: 'The grade to aim for in each course so the semester clears the plan.' },
  { key: 'table.ns.points', page: 'Finish this semester · Courses', subject: 'Grade points', text: 'The points that grade is worth per credit.' },
  { key: 'table.wi.scenario', page: 'What-If · Scenarios', subject: 'Scenario', text: 'Each row is a “what if” — a different assumed average.' },
  { key: 'table.wi.avg', page: 'What-If · Scenarios', subject: 'Period GPA', text: 'The assumed average for the period this scenario covers.' },
  { key: 'table.wi.projected', page: 'What-If · Scenarios', subject: 'Projected CGPA', text: 'Your CGPA after blending in that assumed average.' },
  { key: 'table.wi.vsNow', page: 'What-If · Scenarios', subject: 'Δ vs now', text: 'How much your CGPA moves compared to where you are now.' },
  { key: 'table.wi.vsTarget', page: 'What-If · Scenarios', subject: 'Δ vs target', text: 'How far this scenario lands from your target.' },
  { key: 'table.wi.final', page: 'What-If · Scenarios', subject: 'Final if held', text: 'The final CGPA if you hold that average all the way to graduation.' },
  { key: 'table.wi.feasibility', page: 'What-If · Scenarios', subject: 'Target feasibility', text: 'Whether that average still keeps your target reachable.' },
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
