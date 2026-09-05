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
  // ── Home / My results (the old home + Calculate icons, now registry-driven) ──────────
  { key: 'home.howItWorks', page: 'Home', subject: 'How it works', text: 'Start in My results and enter your current level + CGPA. Every tool below then works from that one number — nothing is saved or shared.' },
  { key: 'calc.standing.released', page: 'My results', subject: 'Your standing · Released', text: 'Released — all your results up to now are out and confirmed. Advanced is for when a few courses from your current standing aren’t out yet — pick exactly which ones and their credits are handled for you.' },
  { key: 'calc.standing.notReleased', page: 'My results', subject: 'Your standing · Not released', text: 'Not released — you’ve written the current semester but none of its results are out. Your CGPA and everything below are based on the immediate past semester. The tools therefore plan what your results will be on release of the semester you just wrote — not a semester after it.' },
  { key: 'calc.standing.justStarted', page: 'My results', subject: 'Your standing · Just started', text: 'Just started — you’ve just begun this semester and have no results. Your CGPA and everything below are based on the immediate past semester. The tools therefore plan how to finish the current semester (its exams are still ahead) — not a semester after it.' },
  { key: 'calc.currentCgpa.released', page: 'My results', subject: 'Current CGPA · released', text: 'This is your confirmed CGPA over results that are out. Courses you mark as not released in Advanced are pulled out of this number and shown as a best / worst projection below.' },
  { key: 'calc.currentCgpa.past', page: 'My results', subject: 'Current CGPA · past semester', text: 'This is your confirmed CGPA over results that are out.' },
  { key: 'calc.history', page: 'My results', subject: 'CGPA history', text: 'CGPA History records your confirmed CGPA for each completed level so you can plan ahead. Pick the level you’re in now. If it’s Not released or Just started, planning is based on the immediate past semester. When Released, use Advanced to mark any of that level’s courses whose results aren’t out yet.' },
  { key: 'calc.modeHelp', page: 'My results', subject: 'How to use this screen', text: 'Tell CGPA Pilot which semester you’re in now and it works everything else out from there. Released — all results are out. Not released — the whole current semester’s results are pending, and your CGPA uses the immediate past semester. Just started — a brand-new semester with no results yet, and your CGPA uses the immediate past semester. Everything is computed on this device — nothing you type leaves the app, is saved, or is stored anywhere.' },
  { key: 'calc.advanced.quick', page: 'My results', subject: 'Advanced · Quick', text: 'When to use Advanced: when almost everything is released but a few courses from the semester you selected aren’t out yet. Tap the exact courses below and their credits are calculated for you — excluded from your confirmed CGPA and shown as a projection until they land.' },
  { key: 'calc.advanced.history', page: 'My results', subject: 'Advanced · History', text: 'When to use Advanced: your current level is released but a few of its courses aren’t out yet. Pick exactly which ones and their credits are excluded from this level’s CGPA and shown as a projection until they land.' },
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
  // ── Screen intros (the big 💡 beside each screen title) ──────────────
  { key: 'flight.intro', page: 'Flight Path', subject: 'The CGPA Flight Path', text: 'This plots where your CGPA is heading, term by term, to graduation. Projected and required lines are scenarios, not promises — your actual route changes with each real result. Nothing is saved.' },
  { key: 'milestones.intro', page: 'Milestones', subject: 'Milestones & affordable drop', text: 'Shows the milestones you need to hit each level to reach your target — and how far you can let a future result slip before the goal gets out of reach. Move the “if I get” slider to test a possible dip in your next GPA. All three scenarios are computed locally and temporarily — nothing is saved or sent.' },
  { key: 'target.intro', page: 'Target', subject: 'Pick a target', text: 'A target is shown as 🔴 out of reach only when even a perfect run — your top grade in every remaining credit — would finish below it. Every other status is still mathematically possible; the colours show how hard you’d have to push. Nothing is saved.' },
  { key: 'target.credits.editable', page: 'Target', subject: 'Credits · editable', text: 'Completed and remaining credits are filled in automatically from your institution’s published curriculum. You can edit either number for a custom scenario (e.g. a different course load). Use the reset button below to snap back to the curriculum values at any time.' },
  { key: 'target.credits.locked', page: 'Target', subject: 'Credits · locked', text: 'These numbers are locked to your institution’s published curriculum — every calculation uses exactly those credits. Your administrator controls this setting.' },
  { key: 'whatif.intro.finish', page: 'What-If', subject: 'What-If Simulator', text: 'Ask “what if I finish this semester at 3.0 / 3.5 / 4.0?” and see how your CGPA would move. This never changes your confirmed calculation, is never saved, and never invents individual grades — it only blends a hypothetical average with your real record.' },
  { key: 'whatif.intro.release', page: 'What-If', subject: 'What-If Simulator', text: 'Ask “what if these pending results average 3.0 / 3.5 / 4.0?” and see how your CGPA would move. This never changes your confirmed calculation, is never saved, and never invents individual grades — it only blends a hypothetical average with your real record.' },
  { key: 'whatif.intro.next', page: 'What-If', subject: 'What-If Simulator', text: 'Ask “what if my next GPA is 3.0 / 3.5 / 4.0?” and see how your CGPA would move. This never changes your confirmed calculation, is never saved, and never invents individual grades — it only blends a hypothetical average with your real record.' },
  { key: 'whatif.results.finish', page: 'What-If · Scenarios', subject: 'Scenario results', text: 'Projected CGPA is your confirmed CGPA blended (credit-weighted) with the hypothetical average for finishing this semester. “Final if held” extrapolates that same average over all remaining credits. None of these are guaranteed outcomes, and no individual course grades are inferred.' },
  { key: 'whatif.results.release', page: 'What-If · Scenarios', subject: 'Scenario results', text: 'Projected CGPA is your confirmed CGPA blended (credit-weighted) with the hypothetical average for the results you just wrote. “Final if held” extrapolates that same average over all remaining credits. None of these are guaranteed outcomes, and no individual course grades are inferred.' },
  { key: 'whatif.results.next', page: 'What-If · Scenarios', subject: 'Scenario results', text: 'Projected CGPA is your confirmed CGPA blended (credit-weighted) with the hypothetical average for next period. “Final if held” extrapolates that same average over all remaining credits. None of these are guaranteed outcomes, and no individual course grades are inferred.' },
  // ── Finish this semester · hero number ──────────────────────────────
  { key: 'next.mission.finish', page: 'Finish this semester', subject: 'Required GPA · hero', text: 'You’re in this semester now, so this is the average you need to finish it to stay on course for your target. It counts this semester’s credits together with everything still ahead, so the numbers add up exactly. It is a steady average to hold from this semester to graduation — not a target for the end of this semester alone. Everything is computed locally and works offline.' },
  { key: 'next.mission.release', page: 'Finish this semester', subject: 'Avg you need · hero', text: 'You’ve already written this semester but its results aren’t out. This is the steady average you need across these pending credits and the semesters still ahead (what this semester needed to earn), and the CGPA you’ll land on once results are released. It is a steady average to hold from this semester to graduation — not a target for the end of this semester alone. Everything is computed locally and works offline.' },
  { key: 'next.mission.next', page: 'Finish this semester', subject: 'Required GPA · hero', text: 'The Required GPA is the semester average you’d need to stay on course for your target over the credits that remain. It is a steady average to hold from this semester to graduation — not a target for the end of this semester alone. Everything is computed locally and works offline.' },
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
