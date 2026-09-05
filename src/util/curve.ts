// ─────────────────────────────────────────────────────────────────────────
// curve — pure SVG path helpers (Catmull-Rom → cubic Bézier smoothing).
// DOM-free and unit-tested; used by the Flight Path graph.
// ─────────────────────────────────────────────────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

/**
 * Smooth curve through every point (Catmull-Rom converted to cubic
 * Bézier segments). Returns an SVG path `d` string.
 *   • 0 points → ''
 *   • 1 point  → a bare move
 *   • 2 points → a straight line
 * `tension` scales the control handles (1 = classic Catmull-Rom).
 */
export function smoothPath(points: Pt[], tension = 1): string {
  if (points.length === 0) return '';
  const f = (v: number) => v.toFixed(1);
  if (points.length === 1) return `M ${f(points[0].x)} ${f(points[0].y)}`;
  if (points.length === 2)
    return `M ${f(points[0].x)} ${f(points[0].y)} L ${f(points[1].x)} ${f(points[1].y)}`;

  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/**
 * Closed area under a smooth curve: smooth top edge, then drop to `baseY`
 * and close back to the start (for gradient fills).
 */
export function smoothAreaPath(points: Pt[], baseY: number): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${smoothPath(points)} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${first.x.toFixed(1)} ${baseY.toFixed(1)} Z`;
}
