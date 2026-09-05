// ─────────────────────────────────────────────────────────────────────────
// permissions — the admin-controlled student permissions.
//
// SINGLE SOURCE OF TRUTH shared by:
//   • the admin console (the Permissions page renders this registry)
//   • the student app (permissionOn() gates tools/behaviours)
//
// Every permission rides the published config as `settings.*` (see
// config/types.ts) — non-personal, ships offline, identical on every
// student device. Add a new permission here and it appears in admin.
// ─────────────────────────────────────────────────────────────────────────

import { getRuntimeCatalog } from './config/runtime';
import type { StudentSettings } from './config/types';

export interface StudentPermission {
  /** Stable id (admin catalog key, or 'ideaTips' for the nested one). */
  id: string;
  /** Toggle label shown in the admin Permissions page. */
  label: string;
  /** One-line effect, shown under the label. */
  hint: string;
  /** Value when the admin has not touched the setting. */
  defaultOn: boolean;
  /** Read the effective state from a settings document. */
  read: (s: StudentSettings | undefined) => boolean;
  /** Produce the next settings document with the toggle applied. */
  write: (s: StudentSettings | undefined, on: boolean) => StudentSettings;
}

export const STUDENT_PERMISSIONS: StudentPermission[] = [
  {
    id: 'allowCreditEditing',
    label: 'Students can edit their credits (completed / remaining)',
    hint: 'Off = the Target tool uses the published curriculum credits only.',
    defaultOn: false,
    read: (s) => s?.allowCreditEditing === true,
    write: (s, on) => ({ ...(s ?? {}), allowCreditEditing: on || undefined }),
  },
  {
    id: 'ideaTips',
    label: 'Show 💡 idea icons on result boxes',
    hint: 'Off = every 💡 hint disappears in the student app.',
    defaultOn: true,
    read: (s) => s?.ideaTips?.enabled !== false,
    write: (s, on) => ({
      ...(s ?? {}),
      // Absent = ON, so OFF must be stored as an explicit false.
      ideaTips: { enabled: on ? undefined : false, texts: s?.ideaTips?.texts },
    }),
  },
  {
    id: 'allowWhatIf',
    label: 'Students can use the What-If simulator',
    hint: 'Off = the What-If tool is hidden from students.',
    defaultOn: true,
    read: (s) => s?.allowWhatIf !== false,
    // Absent = ON, so OFF must be stored as an explicit false.
    write: (s, on) => ({ ...(s ?? {}), allowWhatIf: on ? undefined : false }),
  },
  {
    id: 'allowCustomTarget',
    label: 'Students can set a custom target CGPA',
    hint: 'Off = only the configured degree-class targets can be chosen.',
    defaultOn: true,
    read: (s) => s?.allowCustomTarget !== false,
    write: (s, on) => ({ ...(s ?? {}), allowCustomTarget: on ? undefined : false }),
  },
  {
    id: 'allowPrinting',
    label: 'Students can print or export sheets',
    hint: 'Off = all print buttons are hidden in the student app.',
    defaultOn: true,
    read: (s) => s?.allowPrinting !== false,
    write: (s, on) => ({ ...(s ?? {}), allowPrinting: on ? undefined : false }),
  },
  {
    id: 'playIntroSplash',
    label: 'Play the Sky Dash opening game',
    hint: 'Off = the app opens straight in, without the game.',
    defaultOn: true,
    read: (s) => s?.playIntroSplash !== false,
    write: (s, on) => ({ ...(s ?? {}), playIntroSplash: on ? undefined : false }),
  },
];

const BY_ID: ReadonlyMap<string, StudentPermission> = new Map(
  STUDENT_PERMISSIONS.map((p) => [p.id, p])
);

/** The effective state of a permission on the currently running catalog. */
export function permissionOn(id: string): boolean {
  const p = BY_ID.get(id);
  if (!p) return true;
  return p.read(getRuntimeCatalog().settings);
}
