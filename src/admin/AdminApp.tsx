import { useState } from 'react';
import { useAdmin } from './adminStore';
import { preflightPublish } from './adminApi';
import { writeAdminCatalog } from './adminStorage';
import { Login } from './views/Login';
import { Overview } from './views/Overview';
import { Universities } from './views/Universities';
import { Curricula } from './views/Curricula';
import { CurriculumEditor } from './views/CurriculumEditor';
import { CurriculumPreview } from './views/CurriculumPreview';
import { Grading } from './views/Grading';
import { IdeaIcons } from './views/IdeaIcons';
import { TestLab } from './views/TestLab';
import { RecycleBin } from './views/RecycleBin';
import { IconManager } from './views/IconManager';
import { StudentPreview } from './views/StudentPreview';

type ViewName =
  | 'overview'
  | 'universities'
  | 'curricula'
  | 'grading'
  | 'ideatips'
  | 'appearance'
  | 'recycle'
  | 'previewapp'
  | 'testlab'
  | 'editor'
  | 'preview';
type View = { name: ViewName; curriculumId?: string };

const NAV: { id: View['name']; label: string; icon: string }[] = [
  { id: 'overview', label: 'Dashboard', icon: '📊' },
  { id: 'universities', label: 'Institutions', icon: '🏛️' },
  { id: 'curricula', label: 'Curricula', icon: '📚' },
  { id: 'grading', label: 'Grading & Classes', icon: '🎯' },
  { id: 'ideatips', label: 'Idea Icons', icon: '💡' },
  { id: 'appearance', label: 'Icons & Branding', icon: '🎨' },
  { id: 'recycle', label: 'Recycle Bin', icon: '🗑️' },
  { id: 'previewapp', label: 'Student Preview', icon: '📱' },
  { id: 'testlab', label: 'Test Lab', icon: '🧪' },
];

export function AdminApp() {
  const { authed } = useAdmin();
  const [view, setView] = useState<View>({ name: 'overview' });
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const flashSave = (m: string) => {
    setSaveToast(m);
    window.setTimeout(() => setSaveToast(null), 5000);
  };

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
        <div className="mt-auto space-y-1.5">
          <SaveButtons onToast={flashSave} />
          <BackToApp />
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
          <Brand compact />
          <div className="ml-auto flex items-center gap-2">
            <BackToApp />
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
          {view.name === 'grading' && <Grading />}
          {view.name === 'ideatips' && <IdeaIcons />}
          {view.name === 'appearance' && <IconManager />}
          {view.name === 'recycle' && <RecycleBin />}
          {view.name === 'previewapp' && <StudentPreview />}
          {view.name === 'testlab' && <TestLab />}
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
          <div className="flex gap-2 border-b border-slate-200 p-2">
            <SaveButtons onToast={flashSave} compact />
          </div>
          <div className="flex overflow-x-auto">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setView({ name: n.id } as View)}
                className={`flex min-w-[70px] flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[10px] font-bold ${
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

      {saveToast && (
        <div className="fixed bottom-20 left-1/2 z-50 w-max max-w-[92vw] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-center text-xs font-semibold text-white shadow-lg sm:bottom-6">
          {saveToast}
        </div>
      )}
    </div>
  );
}

/**
 * Global admin actions, available on EVERY page (sidebar on desktop, bottom
 * bar on mobile):
 *  • Save — persist the catalog on THIS admin device only (students see
 *    nothing until a publish happens).
 *  • Save & Publish — persist AND ship the student configuration to the
 *    backend so every device picks it up on its next open (online).
 */
function SaveButtons({ onToast, compact = false }: { onToast: (m: string) => void; compact?: boolean }) {
  const { catalog, publish, syncing } = useAdmin();
  const publishing = syncing === 'publishing';

  function saveLocal() {
    writeAdminCatalog(catalog);
    onToast('💾 Saved on this admin device. Students receive it after Save & Publish.');
  }
  async function saveAndPublish() {
    const pre = preflightPublish(catalog);
    if (!pre.ok) {
      onToast(`⛔ Cannot publish — ${pre.issues[0]}`);
      return;
    }
    const r = await publish();
    if (r.ok) {
      onToast(`✅ Published — catalog v${r.adminVersion} / student config v${r.publishedVersion} is live on every device (next open).`);
    } else {
      onToast(`⛔ ${r.issues?.[0] ?? r.error ?? 'Publish failed — is the backend reachable?'}`);
    }
  }

  if (compact) {
    return (
      <>
        <button
          onClick={saveLocal}
          className="flex-1 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98]"
        >
          💾 Save
        </button>
        <button
          onClick={() => void saveAndPublish()}
          disabled={publishing}
          className="flex-1 rounded-lg bg-brand-600 px-2 py-2 text-[11px] font-black text-white transition hover:bg-brand-700 active:scale-[0.98] disabled:opacity-60"
        >
          {publishing ? 'Publishing…' : '🚀 Save & Publish'}
        </button>
      </>
    );
  }
  return (
    <>
      <button
        onClick={() => void saveAndPublish()}
        disabled={publishing}
        className="w-full rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
      >
        {publishing ? 'Publishing…' : '🚀 Save & Publish'}
      </button>
      <button
        onClick={saveLocal}
        className="w-full rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.99]"
      >
        💾 Save
      </button>
    </>
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

/** Return to the students' app from the admin console. */
function BackToApp() {
  return (
    <button
      onClick={() => {
        try {
          window.location.assign('./index.html');
        } catch {
          window.location.href = './index.html';
        }
      }}
      className="w-full rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100 sm:w-auto"
    >
      ← Users&nbsp;app
    </button>
  );
}
