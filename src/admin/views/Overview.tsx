import { useRef, useState } from 'react';
import { useAdmin } from '../adminStore';
import {
  buildDistribution,
  isDistributionPayload,
} from '../adminConfigService';
import { writeCachedConfig } from '../../services/configCache';

export function Overview({
  onNavigate,
}: {
  onNavigate: (v: { name: 'universities' | 'curricula' }) => void;
}) {
  const { catalog, setCatalog, setPasscode } = useAdmin();
  const [toast, setToast] = useState<string | null>(null);
  const [newPass, setNewPass] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const schools = catalog.universities.reduce((n, u) => n + u.schools.length, 0);
  const programmes = catalog.universities.reduce(
    (n, u) => n + u.schools.reduce((m, s) => m + s.programmes.length, 0),
    0
  );
  const counts = {
    draft: catalog.curricula.filter((c) => c.status === 'draft').length,
    review: catalog.curricula.filter((c) => c.status === 'review').length,
    published: catalog.curricula.filter((c) => c.status === 'published').length,
    archived: catalog.curricula.filter((c) => c.status === 'archived').length,
  };

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function exportDistribution() {
    const payload = buildDistribution(catalog);
    if (payload.curricula.length === 0) {
      flash('No PUBLISHED curricula to distribute yet. Review and publish one first.');
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = payload.generatedAt.slice(0, 10);
    a.href = url;
    a.download = `cgpa-pilot-curriculum-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Versioned configuration downloaded — distribute it for offline use.');
  }

  function applyToThisDevice() {
    const payload = buildDistribution(catalog);
    writeCachedConfig({
      universities: payload.universities,
      curricula: payload.curricula,
      cachedAt: payload.generatedAt,
      schemaVersion: 1,
    });
    flash(
      payload.curricula.length
        ? 'Published configuration applied to the student app on this device.'
        : 'No published curriculum yet — the student app shows "awaiting published curriculum".'
    );
  }

  async function importFile(file: File) {
    try {
      const doc = JSON.parse(await file.text());
      if (!isDistributionPayload(doc)) {
        flash('That file is not a valid CGPA PILOT configuration document.');
        return;
      }
      if (!confirm('Import this configuration? It will replace the current admin catalog.')) return;
      setCatalog({ universities: doc.universities, curricula: doc.curricula });
      flash('Configuration imported.');
    } catch {
      flash('Could not read that file.');
    }
  }

  async function savePass(e: React.FormEvent) {
    e.preventDefault();
    if (newPass.length < 4) {
      flash('Passcode must be at least 4 characters.');
      return;
    }
    await setPasscode(newPass);
    setNewPass('');
    flash('Admin passcode updated.');
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Admin Dashboard</h1>
        <p className="text-xs text-slate-500">
          Manage institutions and published curriculum. Students only ever
          receive PUBLISHED, non-personal configuration.
        </p>
      </header>

      {toast && (
        <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Universities" value={catalog.universities.length} />
        <Stat label="Schools" value={schools} />
        <Stat label="Programmes" value={programmes} />
        <Stat label="Curricula" value={catalog.curricula.length} />
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Curriculum statuses</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusCard label="Draft" value={counts.draft} tone="bg-slate-100 text-slate-700" />
          <StatusCard label="Review" value={counts.review} tone="bg-amber-100 text-amber-800" />
          <StatusCard label="Published" value={counts.published} tone="bg-emerald-100 text-emerald-800" />
          <StatusCard label="Archived" value={counts.archived} tone="bg-slate-200 text-slate-600" />
        </div>
        <button
          onClick={() => onNavigate({ name: 'curricula' })}
          className="btn-ghost mt-4 w-full"
        >
          📚 Manage curricula
        </button>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Offline distribution</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Publishing a curriculum writes the versioned configuration the student
          app caches for offline use. Download the file to bundle it into a
          future app release, or apply it to this device now. Synchronization
          is one-way (config → student); student academic data is never
          uploaded.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={exportDistribution} className="btn-primary">
            ⬇️ Download published configuration
          </button>
          <button onClick={applyToThisDevice} className="btn-ghost">
            📲 Apply to this device (student app)
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-ghost">
            ⬆️ Import configuration file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Change admin passcode</h2>
        <form onSubmit={savePass} className="mt-3 flex flex-wrap items-end gap-2">
          <input
            type="password"
            className="input max-w-xs"
            placeholder="New passcode (min 4 characters)"
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Update
          </button>
        </form>
      </div>

      <button
        onClick={() => onNavigate({ name: 'universities' })}
        className="w-full rounded-2xl border-2 border-dashed border-slate-300 py-3 text-sm font-bold text-slate-500 transition hover:border-slate-400"
      >
        🏛️ Manage universities, schools &amp; programmes
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function StatusCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${tone}`}>
      <p className="text-xl font-black">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}
