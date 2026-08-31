import { useState } from 'react';
import { useAdmin } from './adminStore';
import { Login } from './views/Login';
import { Overview } from './views/Overview';
import { Universities } from './views/Universities';
import { Curricula } from './views/Curricula';
import { CurriculumEditor } from './views/CurriculumEditor';
import { CurriculumPreview } from './views/CurriculumPreview';

type ViewName = 'overview' | 'universities' | 'curricula' | 'editor' | 'preview';
type View = { name: ViewName; curriculumId?: string };

const NAV: { id: View['name']; label: string; icon: string }[] = [
  { id: 'overview', label: 'Dashboard', icon: '📊' },
  { id: 'universities', label: 'Institutions', icon: '🏛️' },
  { id: 'curricula', label: 'Curricula', icon: '📚' },
];

export function AdminApp() {
  const { authed } = useAdmin();
  const [view, setView] = useState<View>({ name: 'overview' });

  if (!authed) return <Login />;

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col sm:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <Brand />
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setView({ name: n.id } as View)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                view.name === n.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
          <Brand compact />
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 sm:pb-10">
          {view.name === 'overview' && (
            <Overview onNavigate={(v) => setView({ name: v.name })} />
          )}
          {view.name === 'universities' && <Universities />}
          {view.name === 'curricula' && (
            <Curricula onOpen={(id) => setView({ name: 'editor', curriculumId: id })} />
          )}
          {view.name === 'editor' && view.curriculumId && (
            <CurriculumEditor
              curriculumId={view.curriculumId}
              onBack={() => setView({ name: 'curricula' })}
              onPreview={(id) => setView({ name: 'preview', curriculumId: id })}
            />
          )}
          {view.name === 'preview' && view.curriculumId && (
            <CurriculumPreview
              curriculumId={view.curriculumId}
              onBack={() => setView({ name: 'editor', curriculumId: view.curriculumId })}
            />
          )}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 sm:hidden">
          <div className="grid grid-cols-3">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setView({ name: n.id } as View)}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${
                  view.name === n.id ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                <span className="text-lg">{n.icon}</span>
                {n.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="./icon-512.png" alt="" className="h-9 w-9 rounded-xl" width={36} height={36} />
      <div>
        <h1 className="text-sm font-black uppercase tracking-wide text-slate-900">
          CGPA <span className="text-brand-600">Pilot</span>
        </h1>
        <p className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 ${compact ? '' : 'mt-0.5'}`}>
          Admin Console
        </p>
      </div>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useAdmin();
  return (
    <button
      onClick={() => {
        if (confirm('Log out of the admin console?')) logout();
      }}
      className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-red-50 hover:text-red-600"
    >
      🔒 Log out
    </button>
  );
}
