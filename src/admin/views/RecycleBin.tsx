import { useMemo, useState } from 'react';
import { useAdmin } from '../adminStore';
import type { AdminCatalog } from '../adminStorage';
import {
  clearTrash,
  purgeTrashItem,
  restoreTrashItem,
} from '../adminConfigService';
import { trashOf, type TrashEntry } from '../adminStorage';

const KIND_META: Record<TrashEntry['kind'], { label: string; icon: string }> = {
  university: { label: 'University', icon: '🏛️' },
  school: { label: 'Department', icon: '🏫' },
  programme: { label: 'Programme', icon: '🎓' },
  curriculum: { label: 'Curriculum version', icon: '📚' },
};

export function RecycleBin() {
  const { catalog, apply } = useAdmin();
  const [toast, setToast] = useState<string | null>(null);
  const trash = useMemo(() => trashOf(catalog), [catalog]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function handleRestore(entry: TrashEntry) {
    const res = restoreTrashItem(catalog, entry.id);
    if (res.ok) {
      apply(() => res.catalog);
      flash(`Restored ${KIND_META[entry.kind].label.toLowerCase()} “${entry.label}”.`);
    } else {
      flash(res.reason ?? 'Could not restore that item.');
    }
  }

  function handlePurge(entry: TrashEntry) {
    if (
      !confirm(
        `Permanently delete ${KIND_META[entry.kind].label.toLowerCase()} “${entry.label}”? This cannot be undone.`
      )
    )
      return;
    apply((c) => purgeTrashItem(c, entry.id));
    flash('Item permanently deleted.');
  }

  function handleEmpty() {
    if (trash.length === 0) return;
    if (
      !confirm(
        `Permanently delete all ${trash.length} item(s) in the recycle bin? This cannot be undone.`
      )
    )
      return;
    apply((c) => clearTrash(c));
    flash('Recycle bin emptied.');
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Recycle bin</h1>
        <p className="text-xs text-slate-500">
          Deleted universities, departments, programmes and curriculum versions
          are kept here so you can recover them. Nothing is permanently removed
          until you purge it.
        </p>
      </header>

      {toast && (
        <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">
          {toast}
        </div>
      )}

      {trash.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-4xl">🗑️</p>
          <p className="mt-2 text-sm font-bold text-slate-600">The recycle bin is empty</p>
          <p className="mt-1 text-xs text-slate-400">
            Items you delete from Institutions or Curricula will appear here for recovery.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">
              {trash.length} item{trash.length === 1 ? '' : 's'}
            </p>
            <button onClick={handleEmpty} className="btn-ghost !text-red-600">
              🗑️ Empty recycle bin
            </button>
          </div>

          <ul className="space-y-2">
            {trash.map((entry) => {
              const meta = KIND_META[entry.kind];
              const parentHint = parentLabel(catalog, entry);
              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-lg">
                      {meta.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-slate-800">
                        {entry.label}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {meta.label}
                        {parentHint ? ` · was in ${parentHint}` : ''}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-[10px] font-semibold text-slate-400">
                    deleted {new Date(entry.deletedAt).toLocaleString()}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => handleRestore(entry)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                    >
                      ↺ Restore
                    </button>
                    <button
                      onClick={() => handlePurge(entry)}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
                    >
                      Delete permanently
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function parentLabel(catalog: AdminCatalog, entry: TrashEntry): string {
  const data = entry.data as { universityId?: string; schoolId?: string; programmeId?: string };
  if (entry.kind === 'curriculum') {
    const progId = entry.parent.programmeId ?? data.programmeId;
    const prog = findProgrammeName(catalog, progId);
    return prog ? `programme “${prog}”` : 'a programme';
  }
  if (entry.kind === 'programme') {
    const schoolId = entry.parent.schoolId ?? data.schoolId;
    const sname = findSchoolName(catalog, schoolId);
    return sname ? `department “${sname}”` : 'a department';
  }
  if (entry.kind === 'school') {
    const uid = entry.parent.universityId ?? data.universityId;
    const uname = catalog.universities.find((u) => u.id === uid)?.name;
    return uname ? `university “${uname}”` : 'a university';
  }
  return '';
}

function findProgrammeName(catalog: AdminCatalog, programmeId?: string): string | undefined {
  if (!programmeId) return undefined;
  for (const u of catalog.universities)
    for (const s of u.schools) {
      const p = s.programmes.find((x) => x.id === programmeId);
      if (p) return p.shortName || p.name;
    }
  return undefined;
}

function findSchoolName(catalog: AdminCatalog, schoolId?: string): string | undefined {
  if (!schoolId) return undefined;
  for (const u of catalog.universities) {
    const s = u.schools.find((x) => x.id === schoolId);
    if (s) return s.name;
  }
  return undefined;
}
