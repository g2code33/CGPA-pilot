import { useMemo, useState } from 'react';
import { Card } from './ui';
import { useInstitution } from '../state/institutionSelection';
import {
  getUniversity,
  listUniversities,
} from '../services/curriculumService';

/**
 * University → School → Programme cascade. Entirely config-driven (reads the
 * bundled/published catalog). The choice lives in in-memory state only — it is
 * not saved, not sent anywhere and never put in a URL.
 */
export function InstitutionSelector({ compact = false }: { compact?: boolean }) {
  const { context, selectUniversity, selectSchool, selectProgramme } =
    useInstitution();
  const [open, setOpen] = useState(false);

  const universities = useMemo(() => listUniversities(), []);
  const university = getUniversity(context.universityId);
  const schools = university?.schools.filter((s) => s.status === 'active') ?? [];
  const programmes =
    schools
      .find((s) => s.id === context.schoolId)
      ?.programmes.filter((p) => p.status === 'active') ?? [];

  const selectClass =
    'input w-full font-semibold';

  return (
    <Card className={compact ? '' : 'bg-gradient-to-br from-white to-brand-50/50'}>
      <div className="flex items-start gap-3">
        {/* Logo display */}
        <div className="shrink-0">
          {university?.logo && (
            <img
              src={university.logo}
              alt={`${university.name} logo`}
              className="h-12 w-12 rounded-xl object-contain shadow-sm ring-1 ring-slate-200"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold text-slate-800">
            Your institution
          </h2>
          <p className="text-xs text-slate-500">
            {university?.name}
            {university?.name ? ' · ' : ''}
            {(() => {
              const s = schools.find((sc) => sc.id === context.schoolId);
              return (
                <>
                  {s?.logo && (
                    <img
                      src={s.logo}
                      alt="Department logo"
                      className="inline-block h-4 w-4 rounded-sm object-contain align-text-bottom mr-1"
                    />
                  )}
                  {s?.name} ·{' '}
                </>
              );
            })()}
            <span className="font-semibold text-brand-700">
              {programmes.find((p) => p.id === context.programmeId)?.shortName ??
                programmes.find((p) => p.id === context.programmeId)?.name}
            </span>
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
        >
          {open ? 'Done' : 'Change'}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="label">University</span>
            <select
              className={selectClass}
              value={context.universityId}
              onChange={(e) => selectUniversity(e.target.value)}
            >
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">School</span>
            <select
              className={selectClass}
              value={context.schoolId}
              onChange={(e) => selectSchool(e.target.value)}
            >
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Programme</span>
            <select
              className={selectClass}
              value={context.programmeId}
              onChange={(e) => selectProgramme(e.target.value)}
            >
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </Card>
  );
}
