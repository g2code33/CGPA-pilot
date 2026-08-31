// ─────────────────────────────────────────────────────────────────────────
// projectionService — target feasibility, maximum possible CGPA, required
// future GPA, flight path, milestones and next-semester projection. Pure.
// ─────────────────────────────────────────────────────────────────────────

// Grade-point ceiling is config-driven (the active grading system's top
// band); 4.0 is the conventional fallback used only if none is supplied.
export const DEFAULT_MAX_POINTS = 4.0;

export type FeasibilityZone = 'achieved' | 'on' | 'off' | 'unknown';

export interface Feasibility {
  feasible: boolean;
  requiredGpa: number | null;
  zone: FeasibilityZone;
  message: string;
}

/** GPA needed over `futureCreditHours` more hours to finish on `target`. */
export function requiredFutureGpa(
  points: number,
  creditHours: number,
  futureCreditHours: number,
  target: number
): number | null {
  if (futureCreditHours <= 0) return null;
  return (target * (creditHours + futureCreditHours) - points) / futureCreditHours;
}

/** Best achievable CGPA if every remaining course earns the top grade. */
export function maxPossibleCgpa(
  points: number,
  creditHours: number,
  remainingCreditHours: number,
  maxPoints: number = DEFAULT_MAX_POINTS
): number | null {
  const total = creditHours + remainingCreditHours;
  if (total <= 0) return null;
  return (points + maxPoints * remainingCreditHours) / total;
}

/** Worst CGPA if pending courses earn 0 points while their credits count. */
export function minPossibleCgpa(
  points: number,
  creditHours: number,
  pendingCreditHours: number
): number | null {
  const total = creditHours + pendingCreditHours;
  if (total <= 0) return null;
  return points / total;
}

export function assessFeasibility(
  points: number,
  creditHours: number,
  futureCreditHours: number,
  target: number,
  currentCgpa: number | null,
  maxPoints: number = DEFAULT_MAX_POINTS
): Feasibility {
  if (currentCgpa === null) {
    return {
      feasible: false,
      requiredGpa: null,
      zone: 'unknown',
      message: 'Enter your record first.',
    };
  }
  if (currentCgpa >= target) {
    return {
      feasible: true,
      requiredGpa: requiredFutureGpa(
        points,
        creditHours,
        Math.max(futureCreditHours, 1),
        target
      ),
      zone: 'achieved',
      message: 'You are already at or above your target — hold the line.',
    };
  }
  const req = requiredFutureGpa(points, creditHours, futureCreditHours, target);
  if (req === null) {
    return {
      feasible: false,
      requiredGpa: null,
      zone: 'unknown',
      message: 'Add remaining credit hours to plan.',
    };
  }
  if (req <= maxPoints + 1e-9) {
    return {
      feasible: true,
      requiredGpa: req,
      zone: 'on',
      message: `Target is reachable — average ${req.toFixed(2)} over the next ${futureCreditHours} credits.`,
    };
  }
  return {
    feasible: false,
    requiredGpa: req,
    zone: 'off',
    message: `You would need ${req.toFixed(2)} — above the ${maxPoints.toFixed(2)} maximum. Target is out of range for this plan.`,
  };
}

export interface FlightPoint {
  step: number;
  label: string;
  creditHours: number;
  cgpa: number;
}

/** Projected CGPA at each future semester assuming a constant semester GPA. */
export function flightPath(
  points: number,
  creditHours: number,
  semesterCreditHours: number[],
  assumedGpa: number
): FlightPoint[] {
  const path: FlightPoint[] = [
    {
      step: 0,
      label: 'Now',
      creditHours,
      cgpa: creditHours > 0 ? points / creditHours : 0,
    },
  ];
  let p = points;
  let c = creditHours;
  semesterCreditHours.forEach((cr, i) => {
    p += assumedGpa * cr;
    c += cr;
    path.push({
      step: i + 1,
      label: `Sem ${i + 1}`,
      creditHours: c,
      cgpa: c > 0 ? p / c : 0,
    });
  });
  return path;
}

/** CGPA after one upcoming semester at a given semester GPA. */
export function projectNextSemester(
  points: number,
  creditHours: number,
  nextCreditHours: number,
  gpa: number
): number | null {
  const total = creditHours + nextCreditHours;
  if (total <= 0) return null;
  return (points + gpa * nextCreditHours) / total;
}

/** Minimum future credit hours at the top grade needed to reach the target. */
export function creditHoursToTargetAtStraightA(
  points: number,
  creditHours: number,
  target: number,
  maxPoints: number = DEFAULT_MAX_POINTS
): number | null {
  if (creditHours <= 0) return null;
  const denom = maxPoints - target;
  if (denom <= 0) return 0;
  const n = (target * creditHours - points) / denom;
  return n > 0 ? n : 0;
}

/** Milestone classifications for a set of flight points (config-driven). */
export function projectedArrival(path: FlightPoint): FlightPoint {
  return path;
}
