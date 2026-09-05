// ─────────────────────────────────────────────────────────────────────────
// Permissions — the admin's list of EVERY student permission, in one
// section (more will be added here over time; the list is driven by the
// shared STUDENT_PERMISSIONS registry in src/permissions.ts).
//
// Each toggle ships with the published config (settings.*) — identical on
// every student device, works offline, live after Save & Publish.
// ─────────────────────────────────────────────────────────────────────────

import { useAdmin } from '../adminStore';
import { STUDENT_PERMISSIONS } from '../../permissions';

export function Permissions() {
  const { catalog, apply } = useAdmin();
  const onCount = STUDENT_PERMISSIONS.filter((p) =>
    p.read(catalog.settings)
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-slate-900">🔐 Permissions</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-black text-brand-700 ring-1 ring-brand-100">
          {onCount} of {STUDENT_PERMISSIONS.length} on
        </span>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h3 className="text-sm font-bold text-slate-800">Student permissions</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Rules every student device follows. Changes go live on every device
          after Save &amp; Publish.
        </p>
        <div className="mt-3 space-y-2">
          {STUDENT_PERMISSIONS.map((p) => {
            const on = p.read(catalog.settings);
            return (
              <label
                key={p.id}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200"
              >
                <span>
                  <span className="block text-xs font-bold text-slate-700">{p.label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{p.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    apply((c) => ({
                      ...c,
                      settings: p.write(c.settings, e.target.checked),
                    }))
                  }
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
