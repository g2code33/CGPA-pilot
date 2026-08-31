// ─────────────────────────────────────────────────────────────────────────
// Projection & planning math. All pure, all offline.
// ─────────────────────────────────────────────────────────────────────────

const MAX_POINTS = 4.0;

export interface Feasibility {
  feasible: boolean;
  requiredGpa: number | null;
  /** 'achieved' already at/above target, 'on' possible, 'off' impossible */
  zone: 'achieved' | 'on' | 'off' | 'unknown';
  message: string;
}

/** GPA needed over `futureCredits` more hours to finish on `target`. */
export function requiredFutureGpa(
  points: number,
  credits: number,
  futureCredits: number,
  target: number
): number | null {
  if (futureCredits <= 0) return null;
  return (target * (credits + futureCredits) - points) / futureCredits;
}

/** Best achievable CGPA if every pending/future course is an A. */
export function maxPossibleCgpa(
  points: number,
  credits: number,
  remainingCredits: number
): number | null {
  const total = credits + remainingCredits;
  if (total <= 0) return null;
  return (points + MAX_POINTS * remainingCredits) / total;
}

/** Worst realistic CGPA if pending courses are Es (0 points) but credits count. */
export function minPossibleCgpa(
  points: number,
  credits: number,
  pendingCredits: number
): number | null {
  const total = credits + pendingCredits;
  if (total <= 0) return null;
  return points / total;
}

export function assessFeasibility(
  points: number,
  credits: number,
  futureCredits: number,
  target: number,
  currentCgpa: number | null
): Feasibility {
  if (currentCgpa === null) {
    return { feasible: false, requiredGpa: null, zone: 'unknown', message: 'Enter your record first.' };
  }
  if (currentCgpa >= target) {
    return {
      feasible: true,
      requiredGpa: requiredFutureGpa(points, credits, Math.max(futureCredits, 1), target),
      zone: 'achieved',
      message: 'You are already at or above your target — hold the line.',
    };
  }
  const req = requiredFutureGpa(points, credits, futureCredits, target);
  if (req === null) {
    return { feasible: false, requiredGpa: null, zone: 'unknown', message: 'Add remaining credits to plan.' };
  }
  if (req <= MAX_POINTS) {
    return {
      feasible: true,
      requiredGpa: req,
      zone: 'on',
      message: `Target is reachable — average ${req.toFixed(2)} over the next ${futureCredits} credits.`,
    };
  }
  return {
    feasible: false,
    requiredGpa: req,
    zone: 'off',
    message: `You would need ${req.toFixed(2)} — above the 4.00 maximum. Target is out of range for this plan.`,
  };
}

/**
 * Flight path: projected CGPA after each future semester, assuming a
 * constant semester GPA. Returns points for the graph.
 */
export interface FlightPoint {
  step: number;
  label: string;
  credits: number;
  cgpa: number;
}

export function flightPath(
  points: number,
  credits: number,
  semesterCredits: number[],
  assumedGpa: number
): FlightPoint[] {
  const path: FlightPoint[] = [
    { step: 0, label: 'Now', credits, cgpa: credits > 0 ? points / credits : 0 },
  ];
  let p = points;
  let c = credits;
  semesterCredits.forEach((cr, i) => {
    p += assumedGpa * cr;
    c += cr;
    path.push({
      step: i + 1,
      label: `Sem ${i + 1}`,
      credits: c,
      cgpa: c > 0 ? p / c : 0,
    });
  });
  return path;
}

/** CGPA at each future semester if the student scores exactly `gpa` next. */
export function projectNextSemester(
  points: number,
  credits: number,
  nextCredits: number,
  gpa: number
): number | null {
  const total = credits + nextCredits;
  if (total <= 0) return null;
  return (points + gpa * nextCredits) / total;
}

/** Minimum future credits at straight As needed to reach the target. */
export function creditsToTargetAtStraightA(
  points: number,
  credits: number,
  target: number
): number | null {
  if (credits <= 0) return null;
  const denom = MAX_POINTS - target;
  if (denom <= 0) return 0;
  const n = (target * credits - points) / denom;
  return n > 0 ? n : 0;
}
