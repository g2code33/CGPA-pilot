/**
 * Launch modes — pure decision logic, so the recovery ladder can be tested
 * without Electron (test/desktopRendererPath.test.mjs). The Electron side keeps
 * only the glue: applying switches, relaunching, and the "did it paint?" watch.
 *
 * WHY A LADDER AT ALL. On Linux an app can fail to show anything for reasons
 * that cannot be detected before the launch, only after: a kernel that will not
 * allow the sandbox Chromium wants (`Zygote could not fork … write: Broken
 * pipe`, then a segfault where the window should be), a GPU process that dies
 * with the renderer, a read-only or hand-copied install whose setuid helper was
 * never chmod'ed. The alternative to a ladder is a blank window and a bug report.
 *
 * So: try the normal mode; if nothing painted, relaunch ONCE in the next, more
 * conservative mode and remember the reason; whichever mode paints becomes the
 * remembered one, so the dance is never repeated. A machine where every mode
 * fails gets the diagnostic page instead of a relaunch loop — `escalate()` is
 * total about that, and the CLI/env hand-off means the guard survives a crash
 * that happens before the state file can be written.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface LaunchMode {
  name: string;
  /** Chromium switches, without the leading dashes. */
  flags: string[];
  note: string;
}

export const LAUNCH_MODES: LaunchMode[] = [
  { name: 'default', flags: [], note: 'as packaged, sandboxed' },
  { name: 'no-sandbox', flags: ['no-sandbox'], note: 'renderer without the OS sandbox' },
  {
    name: 'no-zygote',
    flags: ['no-sandbox', 'no-zygote', 'disable-gpu'],
    note: 'no zygote and no GPU process — last resort before giving up',
  },
];

/** How long a launch may stay unpainted before it counts as a failure. */
export const STARTUP_GRACE_MS = 12000;

/** The env var the relaunch hand-off uses (loop guard across processes). */
export const LAUNCH_MODE_ENV = 'CGPA_LAUNCH_MODE';

/** Opt out of the remembered mode: `cgpa-pilot --launch-mode-default`. */
export const LAUNCH_MODE_RESET_FLAG = '--launch-mode-default';

export interface LaunchModeState {
  mode: number;
  /** Why the previous launch was escalated — quoted back to the user. */
  reason?: string;
  at?: string;
  failures?: number;
  paintedAt?: string;
}

export function clampMode(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(LAUNCH_MODES.length - 1, Math.max(0, Math.trunc(n)));
}

/**
 * The mode for this process: an explicit CLI reset wins (support hatch), then
 * the relaunch hand-off in the environment, then what worked last time.
 */
export function chooseLaunchMode(input: {
  argv: string[];
  env?: Record<string, string | undefined>;
  state?: LaunchModeState | null;
}): number {
  if (input.argv.includes(LAUNCH_MODE_RESET_FLAG)) return 0;
  const fromEnv = input.env?.[LAUNCH_MODE_ENV];
  if (fromEnv !== undefined && fromEnv !== '') return clampMode(fromEnv);
  return clampMode(input.state?.mode ?? 0);
}

/** Flags to append for `mode`, skipping any the user already passed. */
export function launchFlags(mode: number, argv: string[] = []): string[] {
  const entry = LAUNCH_MODES[clampMode(mode)];
  return entry.flags.filter((f) => !argv.includes(`--${f}`));
}

export interface Escalation {
  /** The mode to relaunch in, or null when the ladder is exhausted. */
  next: number | null;
  state: LaunchModeState;
  /** True when every mode has now failed — show the diagnostic page. */
  terminal: boolean;
}

/**
 * Record that `mode` failed to paint. Never mutates; the returned state is what
 * belongs in the file. `next === null` (== `terminal`) is the loop stop.
 */
export function escalate(mode: number, reason: string, previous?: LaunchModeState | null): Escalation {
  const failures = (previous?.failures ?? 0) + 1;
  const at = new Date().toISOString();
  const candidate = clampMode(mode) + 1;
  if (candidate >= LAUNCH_MODES.length) {
    return {
      next: null,
      terminal: true,
      state: { mode: clampMode(mode), reason, at, failures, paintedAt: previous?.paintedAt },
    };
  }
  return {
    next: candidate,
    terminal: false,
    state: { mode: candidate, reason, at, failures },
  };
}

/**
 * The state to persist after a successful paint, or null when nothing changed
 * (the common case — a normal launch must not write a file every start).
 */
export function markPainted(mode: number, previous?: LaunchModeState | null): LaunchModeState | null {
  const current = clampMode(mode);
  if (!previous) {
    // Nothing was ever recorded and nothing went wrong — leave the directory
    // alone rather than writing a file on every first launch.
    return current === 0 ? null : finishedState(current, previous);
  }
  const alreadyClean =
    (previous.mode ?? 0) === current && !previous.reason && (previous.failures ?? 0) === 0 && !!previous.paintedAt;
  return alreadyClean ? null : finishedState(current, previous);
}

function finishedState(mode: number, previous?: LaunchModeState | null): LaunchModeState {
  return { mode, reason: undefined, at: previous?.at, failures: 0, paintedAt: new Date().toISOString() };
}

/** Args to hand the relaunched process: ours, minus the mode switches. */
export function relaunchArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => !a.startsWith('--launch-mode-') && a !== LAUNCH_MODE_RESET_FLAG);
}

// ── persistence (a file in userData; corrupt or missing is mode 0) ─────────

export function readLaunchState(file: string): LaunchModeState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as LaunchModeState;
    if (!raw || typeof raw !== 'object') return null;
    return { ...raw, mode: clampMode(raw.mode) };
  } catch {
    return null;
  }
}

export function writeLaunchState(file: string, state: LaunchModeState): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    return true;
  } catch {
    return false; // forgetting what worked is not worth failing a launch over
  }
}
