import type { ClassificationBand } from '../config/types';
import { requiredFutureGpa } from './projection';
import { fmt2 } from './format';

export interface BriefInput {
  cgpa: number | null;
  credits: number;
  pendingCredits: number;
  pendingCount: number;
  target: number | null;
  remainingCredits: number;
  classification: ClassificationBand | null;
  targetClassLabel: string;
}

/** Human-readable Pilot Brief lines — the "status report" from your co-pilot. */
export function buildBrief(i: BriefInput): string[] {
  const lines: string[] = [];

  if (i.cgpa === null) {
    lines.push('No graded record yet — open Calculate to enter results or your current CGPA.');
    return lines;
  }

  lines.push(
    `Your current CGPA is ${fmt2(i.cgpa)} across ${i.credits} graded credit${i.credits === 1 ? '' : 's'}.`
  );

  if (i.classification) {
    lines.push(`Current standing: ${i.classification.label}.`);
  }

  if (i.pendingCount > 0) {
    lines.push(
      `${i.pendingCount} pending result${i.pendingCount === 1 ? '' : 's'} (${i.pendingCredits} credits) are not yet counted — use What-If to preview them.`
    );
  }

  if (i.target !== null) {
    if (i.cgpa >= i.target) {
      lines.push(`You are at/above your ${fmt2(i.target)} target (${i.targetClassLabel}). Maintain it.`);
    } else if (i.remainingCredits > 0) {
      const req = requiredFutureGpa(
        i.cgpa * i.credits,
        i.credits,
        i.remainingCredits,
        i.target
      );
      if (req !== null) {
        if (req <= 4.0) {
          lines.push(
            `Target ${fmt2(i.target)} (${i.targetClassLabel}) needs an average of ${fmt2(req)} over your next ${i.remainingCredits} credits.`
          );
        } else {
          lines.push(
            `Target ${fmt2(i.target)} (${i.targetClassLabel}) is out of range with only ${i.remainingCredits} credits remaining — raise the target or review your plan on the Target tab.`
          );
        }
      }
    } else {
      lines.push('Set your remaining credits on the Target tab for a full feasibility read.');
    }
  }

  return lines;
}
