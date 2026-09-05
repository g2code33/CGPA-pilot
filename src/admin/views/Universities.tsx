import { useState } from 'react';
import { useAdmin } from '../adminStore';
import type { Programme, School, University } from '../../config/types';
import {
  addUniversity,
  updateUniversity,
  setUniversityStatus,
  canDeleteUniversity,
  deleteUniversity,
  addSchool,
  updateSchool,
  setSchoolStatus,
  canDeleteSchool,
  deleteSchool,
  addProgramme,
  updateProgramme,
  setProgrammeStatus,
  canDeleteProgramme,
  deleteProgramme,
} from '../adminConfigService';

export function Universities() {
  const { catalog, apply } = useAdmin();

  const [newUni, setNewUni] = useState({ name: '', shortName: '', country: 'Ghana' });

  function confirmAction(msg: string, fn: () => void) {
    if (confirm(msg)) fn();
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Institutions</h1>
      </header>

      {/* Add university */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-bold text-slate-800">Add university</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            className="input sm:col-span-2"
            placeholder="University name"
            value={newUni.name}
            onChange={(e) => setNewUni({ ...newUni, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Short name"
            value={newUni.shortName}
            onChange={(e) => setNewUni({ ...newUni, shortName: e.target.value })}
          />
          <button
            className="btn-primary"
            disabled={!newUni.name || !newUni.shortName}
            onClick={() => {
              apply((c) => addUniversity(c, newUni));
              setNewUni({ name: '', shortName: '', country: 'Ghana' });
            }}
          >
            ＋ Add
          </button>
        </div>
      </div>

      {catalog.universities.map((u) => (
        <UniversityCard
          key={u.id}
          university={u}
          apply={apply}
          onConfirm={confirmAction}
        />
      ))}
    </div>
  );
}

function StatusToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${
        active
          ? 'bg-emerald-100 text-emerald-700 ring-emerald-300'
          : 'bg-slate-100 text-slate-500 ring-slate-300'
      }`}
    >
      {active ? '● Active' : '○ Inactive'}
    </button>
  );
}

function UniversityCard({
  university,
  apply,
  onConfirm,
}: {
  university: University;
  apply: ReturnType<typeof useAdmin>['apply'];
  onConfirm: (msg: string, fn: () => void) => void;
}) {
  const [showSchool, setShowSchool] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const canDelete = canDeleteUniversity(useAdmin().catalog, university.id);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs font-bold"
          value={university.name}
          onChange={(e) =>
            apply((c) => updateUniversity(c, university.id, { name: e.target.value }))
          }
        />
        <input
          className="input w-24"
          value={university.shortName}
          onChange={(e) =>
            apply((c) => updateUniversity(c, university.id, { shortName: e.target.value }))
          }
        />
        <input
          className="input w-32"
          value={university.country}
          onChange={(e) =>
            apply((c) => updateUniversity(c, university.id, { country: e.target.value }))
          }
        />
        <LogoField
          value={university.logo ?? ''}
          onValue={(v) =>
            apply((c) => updateUniversity(c, university.id, { logo: v || undefined }))
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <StatusToggle
            active={university.status === 'active'}
            onToggle={() =>
              onConfirm(
                `${university.status === 'active' ? 'Deactivate' : 'Activate'} ${university.name}?`,
                () =>
                  apply((c) =>
                    setUniversityStatus(
                      c,
                      university.id,
                      university.status === 'active' ? 'inactive' : 'active'
                    )
                  )
              )
            }
          />
          {canDelete && (
            <button
              className="rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100"
              onClick={() =>
                onConfirm(`Delete university "${university.name}"? It moves to the Recycle bin and can be restored later.`, () =>
                  apply((c) => deleteUniversity(c, university.id))
                )
              }
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-3 pl-2 sm:pl-4">
        {university.schools.map((s) => (
          <SchoolRow key={s.id} school={s} apply={apply} onConfirm={onConfirm} />
        ))}

        {showSchool ? (
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              placeholder="New department name"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              autoFocus
            />
            <button
              className="btn-primary"
              disabled={!schoolName}
              onClick={() => {
                apply((c) => addSchool(c, university.id, schoolName));
                setSchoolName('');
                setShowSchool(false);
              }}
            >
              Save
            </button>
            <button className="btn-ghost" onClick={() => setShowSchool(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="text-xs font-bold text-brand-600 hover:underline"
            onClick={() => setShowSchool(true)}
          >
            ＋ Add department
          </button>
        )}
      </div>
    </section>
  );
}

function SchoolRow({
  school,
  apply,
  onConfirm,
}: {
  school: School;
  apply: ReturnType<typeof useAdmin>['apply'];
  onConfirm: (msg: string, fn: () => void) => void;
}) {
  const [showProg, setShowProg] = useState(false);
  const [prog, setProg] = useState({ name: '', shortName: '', years: 4 });
  const catalog = useAdmin().catalog;
  const canDelete = canDeleteSchool(catalog, school.id);

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">🏫</span>
        <input
          className="input max-w-xs font-semibold"
          value={school.name}
          onChange={(e) => apply((c) => updateSchool(c, school.id, { name: e.target.value }))}
        />
        <LogoField
          value={school.logo ?? ''}
          onValue={(v) =>
            apply((c) => updateSchool(c, school.id, { logo: v || undefined }))
          }
        />
        <div className="ml-auto flex items-center gap-2">
          <StatusToggle
            active={school.status === 'active'}
            onToggle={() =>
              onConfirm(`${school.status === 'active' ? 'Deactivate' : 'Activate'} ${school.name}?`, () =>
                apply((c) =>
                  setSchoolStatus(c, school.id, school.status === 'active' ? 'inactive' : 'active')
                )
              )
            }
          />
          {canDelete && (
            <button
              className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100"
              onClick={() => onConfirm(`Delete department "${school.name}"? It moves to the Recycle bin and can be restored later.`, () => apply((c) => deleteSchool(c, school.id)))}
            >
              🗑
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-2 pl-4 sm:pl-8">
        {school.programmes.map((p) => (
          <ProgrammeRow key={p.id} programme={p} apply={apply} onConfirm={onConfirm} />
        ))}

        {showProg ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200">
            <input
              className="input flex-1 min-w-[140px]"
              placeholder="Programme name"
              value={prog.name}
              onChange={(e) => setProg({ ...prog, name: e.target.value })}
            />
            <input
              className="input w-24"
              placeholder="Short"
              value={prog.shortName}
              onChange={(e) => setProg({ ...prog, shortName: e.target.value })}
            />
            <label className="text-[10px] font-bold uppercase text-slate-400">
              Years
              <input
                type="number"
                min={1}
                max={8}
                className="input w-16 text-center"
                value={prog.years}
                onChange={(e) => setProg({ ...prog, years: Number(e.target.value) || 4 })}
              />
            </label>
            <button
              className="btn-primary"
              disabled={!prog.name || !prog.shortName}
              onClick={() => {
                apply((c) => addProgramme(c, school.id, prog));
                setProg({ name: '', shortName: '', years: 4 });
                setShowProg(false);
              }}
            >
              Save
            </button>
            <button className="btn-ghost" onClick={() => setShowProg(false)}>
              ✕
            </button>
          </div>
        ) : (
          <button
            className="text-xs font-bold text-brand-600 hover:underline"
            onClick={() => setShowProg(true)}
          >
            ＋ Add programme
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Logo picker for an institution/school: a straight image-file upload (read as
 * a data URL so it works fully offline) OR a URL/path field, with a live
 * thumbnail preview. Whatever is set is stored on the `logo` field and shown
 * nicely to students via the same logo lookup.
 */
function LogoField({
  value,
  onValue,
}: {
  value: string;
  onValue: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  function handleFile(file?: File | null) {
    setErr('');
    if (!file) return;
    if (file.size > 2_000_000) {
      setErr('Keep logos under ~2 MB.');
      return;
    }
    if (!/^image\//.test(file.type)) {
      setErr('Please choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onValue(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setErr('Could not read that file.');
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-white p-1.5 ring-1 ring-slate-200">
      {value ? (
        <img
          src={value}
          alt=""
          className="h-9 w-9 shrink-0 rounded-lg bg-slate-100 object-contain ring-1 ring-slate-200"
        />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
          🖼️
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-lg px-2 py-1 text-[11px] font-bold ring-1 transition ${
          open ? 'bg-brand-600 text-white ring-brand-600' : 'bg-brand-50 text-brand-700 ring-brand-200'
        }`}
        title="Set a logo image"
      >
        Logo
      </button>
      {open && (
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200">
            ⬆ Upload
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <input
            className="input w-40 py-1 text-xs"
            placeholder="…or paste an image URL"
            value={value.startsWith('data:') ? '' : value}
            onChange={(e) => {
              setErr('');
              onValue(e.target.value);
            }}
          />
          {value && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-red-500"
              title="Remove logo"
              onClick={() => onValue('')}
            >
              ✕
            </button>
          )}
        </div>
      )}
      {err && <span className="text-[10px] font-bold text-red-500">{err}</span>}
    </div>
  );
}

function ProgrammeRow({
  programme,
  apply,
  onConfirm,
}: {
  programme: Programme;
  apply: ReturnType<typeof useAdmin>['apply'];
  onConfirm: (msg: string, fn: () => void) => void;
}) {
  const catalog = useAdmin().catalog;
  const canDelete = canDeleteProgramme(catalog, programme.id);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200">
      <span className="text-sm">🎓</span>
      <input
        className="input flex-1 min-w-[120px] text-sm font-semibold"
        value={programme.name}
        onChange={(e) => apply((c) => updateProgramme(c, programme.id, { name: e.target.value }))}
      />
      <input
        className="input w-20 text-sm"
        value={programme.shortName}
        onChange={(e) => apply((c) => updateProgramme(c, programme.id, { shortName: e.target.value }))}
      />
      <label className="text-[10px] font-bold uppercase text-slate-400">
        Yrs
        <input
          type="number"
          min={1}
          max={8}
          className="input w-14 text-center"
          value={programme.duration.years}
          onChange={(e) => {
            const years = Number(e.target.value) || 4;
            apply((c) =>
              updateProgramme(c, programme.id, {
                duration: { ...programme.duration, years, expectedLevels: years },
              })
            );
          }}
        />
      </label>
      <StatusToggle
        active={programme.status === 'active'}
        onToggle={() =>
          onConfirm(`${programme.status === 'active' ? 'Deactivate' : 'Activate'} ${programme.shortName}?`, () =>
            apply((c) =>
              setProgrammeStatus(c, programme.id, programme.status === 'active' ? 'inactive' : 'active')
            )
          )
        }
      />
      {canDelete ? (
        <button
          className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100"
          onClick={() => onConfirm(`Delete programme "${programme.name}" and its curriculum references? It moves to the Recycle bin and can be restored later.`, () => apply((c) => deleteProgramme(c, programme.id)))}
        >
          🗑
        </button>
      ) : (
        <span title="Has a published curriculum — archive it instead of deleting" className="text-[10px] font-bold text-slate-400">
          🔒 protected
        </span>
      )}
    </div>
  );
}
