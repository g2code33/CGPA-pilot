import { useState } from 'react';
import { useAdmin } from './adminStore';
import { appLogoImage } from '../config/branding';
import type { AppAppearance } from '../config/types';
import { preflightPublish, fetchBackendCatalog, saveRemoteDraft } from './adminApi';
import {
  writeAdminCatalog,
  readPublishedSnapshot,
  writePublishedSnapshot,
  saveLocalDraft,
  markLocalDraftSynced,
  type AdminCatalog,
} from './adminStorage';
import { diffCatalogs } from './catalogDiff';
import { Login } from './views/Login';
import { Overview } from './views/Overview';
import { Universities } from './views/Universities';
import { Curricula } from './views/Curricula';
import { CurriculumEditor } from './views/CurriculumEditor';
import { CurriculumPreview } from './views/CurriculumPreview';
import { Grading } from './views/Grading';
import { IdeaIcons } from './views/IdeaIcons';
import { Permissions } from './views/Permissions';
import { TestLab } from './views/TestLab';
import { RecycleBin } from './views/RecycleBin';
import { IconManager } from './views/IconManager';
import { StudentPreview } from './views/StudentPreview';
import { AiSettings } from './views/AiSettings';
import { AiMonitor } from './views/AiMonitor';
import { PublishPreview } from './components/PublishPreview';
import { DraftsPanel } from './components/DraftsPanel';

type ViewName =
  | 'overview'
  | 'universities'
  | 'curricula'
  | 'grading'
  | 'ideatips'
  | 'permissions'
  | 'appearance'
  | 'aisettings'
  | 'aimonitor'
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
  { id: 'permissions', label: 'Permissions', icon: '🔐' },
  { id: 'appearance', label: 'Icons & Branding', icon: '🎨' },
  { id: 'aisettings', label: 'AI Assistant', icon: '🤖' },
  { id: 'aimonitor', label: 'AI Monitor', icon: '🩺' },
  { id: 'recycle', label: 'Recycle Bin', icon: '🗑️' },
  { id: 'previewapp', label: 'Student Preview', icon: '📱' },
  { id: 'testlab', label: 'Test Lab', icon: '🧪' },
];

/** What the publish preview is showing (working catalog OR a draft). */
interface PreviewState {
  working: AdminCatalog;
  published: AdminCatalog | null;
  publishedVersion: number | null;
  /** When set, the preview is for a DRAFT (publish button label changes). */
  draftName?: string;
}

export function AdminApp() {
  const { authed, catalog } = useAdmin();
  const [view, setView] = useState<View>({ name: 'overview' });
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const flashSave = (m: string) => {
    setSaveToast(m);
    window.setTimeout(() => setSaveToast(null), 5000);
  };

  if (!authed) return <Login />;

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col sm:flex-row">
      {/* Sticky full-height sidebar: brand header + save actions stay in
          place while the main content scrolls (never scroll away). */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 sm:flex">
        <Brand appearance={catalog.appearance} />
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
          <Brand compact appearance={catalog.appearance} />
          <div className="ml-auto flex items-center gap-2">
            <BackToApp />
            <LogoutButton />
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 sm:pb-10">
          {view.name === 'overview' && <Overview onNavigate={(v) => setView({ name: v.name })} />}
          {view.name === 'universities' && <Universities />}
          {view.name === 'curricula' && (
            <Curricula onOpen={(id) => setView({ name: 'editor', curriculumId: id })} />
          )}
          {view.name === 'grading' && <Grading />}
          {view.name === 'ideatips' && <IdeaIcons />}
          {view.name === 'permissions' && <Permissions />}
          {view.name === 'appearance' && <IconManager />}
          {view.name === 'aisettings' && (
            <AiSettings toast={flashSave} onNavigate={(v) => setView({ name: v as View['name'] })} />
          )}
          {view.name === 'aimonitor' && <AiMonitor toast={flashSave} />}
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

/** Small centered modal for the draft name. */
function NameDialog(props: {
  title: string;
  caption: string;
  initial: string;
  placeholder: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [name, setName] = useState(props.initial);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={props.onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-black text-slate-900">{props.title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{props.caption}</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !props.busy) props.onConfirm();
            if (e.key === 'Escape') props.onCancel();
          }}
          placeholder={props.placeholder}
          className="mt-3 w-full rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={props.onCancel} className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={props.onConfirm}
            disabled={props.busy}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Global admin actions, available on EVERY page (sidebar on desktop, bottom
 * bar on mobile):
 *  • Save — persist the catalog on THIS admin device only (students see
 *    nothing until a publish happens).
 *  • Save Draft — snapshot the catalog WITHOUT publishing (restore / preview
 *    / delete any time, on any admin device).
 *  • Preview — review the exact diff vs the published catalog BEFORE shipping.
 *  • Save & Publish — persist AND ship the student configuration to the
 *    backend so every device picks it up on its next open (online).
 */
function SaveButtons({ onToast, compact = false }: { onToast: (m: string) => void; compact?: boolean }) {
  const { catalog, publish, syncing, apply } = useAdmin();
  const publishing = syncing === 'publishing';
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);

  // Lifted preview state: the Preview modal must survive SaveButtons unmount
  // (mobile nav), so it renders here too.
  const [preview, setPreview] = useState<PreviewState | null>(null);

  async function resolvePublished(): Promise<{ catalog: AdminCatalog | null; version: number | null }> {
    const snap = readPublishedSnapshot();
    if (snap) return { catalog: snap.catalog, version: snap.version };
    const r = await fetchBackendCatalog();
    if (r.ok && r.catalog) {
      writePublishedSnapshot(r.catalog, r.adminVersion ?? null);
      return { catalog: r.catalog, version: r.adminVersion ?? null };
    }
    return { catalog: null, version: null };
  }

  function saveLocal() {
    writeAdminCatalog(catalog);
    onToast('💾 Saved on this admin device. Students receive it after Save & Publish.');
  }

  async function saveAndPublish(catalogToPublish?: AdminCatalog) {
    // Publish EXACTLY the catalog passed in (a preview may pass the draft it
    // was showing) — never something the admin did not just review.
    const target = catalogToPublish ?? catalog;
    const isDraft = catalogToPublish !== undefined && catalogToPublish !== catalog;
    const pre = preflightPublish(target);
    if (!pre.ok) {
      onToast(`⛔ Cannot publish — ${pre.issues[0]}`);
      return;
    }
    const r = await publish(undefined, catalogToPublish);
    if (r.ok) {
      setPreview(null);
      onToast(
        `✅ ${isDraft ? 'Draft published' : 'Published'} — catalog v${r.adminVersion} / student config v${r.publishedVersion} is live on every device (next open).`
      );
    } else {
      onToast(`⛔ ${r.issues?.[0] ?? r.error ?? 'Publish failed — is the backend reachable?'}`);
    }
  }

  function openPreview() {
    void (async () => {
      const pub = await resolvePublished();
      setPreview({ working: catalog, published: pub.catalog, publishedVersion: pub.version });
      setPreviewOpen(true); // open only once the reference is resolved
    })();
  }

  async function doSaveDraft() {
    const name = draftName.trim() || `Draft — ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    setDraftBusy(true);
    try {
      const id = `draft-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      saveLocalDraft({ id, name, note: null, createdAt: now, synced: false, catalog });
      const r = await saveRemoteDraft(id, name, catalog, null);
      if (r.ok) {
        markLocalDraftSynced(id);
        const diff = diffCatalogs(readPublishedSnapshot()?.catalog ?? null, catalog);
        onToast(`📝 Draft “${name}” saved — ${diff.summary.toLowerCase()}. Students are NOT seeing it.`);
      } else {
        onToast(`💾 Draft “${name}” saved on THIS device only (offline). It will show in Drafts.`);
      }
      setDraftName('');
      setSaveDraftOpen(false);
    } finally {
      setDraftBusy(false);
    }
  }

  const previewBtn = (
    <button
      onClick={openPreview}
      className={
        compact
          ? 'flex-1 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98]'
          : 'w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.99]'
      }
    >
      🔍 Preview changes
    </button>
  );
  const draftBtn = (
    <button
      onClick={() => setSaveDraftOpen(true)}
      className={
        compact
          ? 'flex-1 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98]'
          : 'w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.99]'
      }
    >
      📝 Save Draft
    </button>
  );
  const draftsBtn = (
    <button
      onClick={() => setDraftsOpen(true)}
      className={
        compact
          ? 'flex-1 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 active:scale-[0.98]'
          : 'w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-[0.99]'
      }
    >
      📥 Drafts
    </button>
  );

  return (
    <>
      {compact ? (
        <>
          <div className="flex gap-2">
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
          </div>
          <div className="flex gap-2">
            {previewBtn}
            {draftBtn}
            {draftsBtn}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => void saveAndPublish()}
            disabled={publishing}
            className="w-full rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
          >
            {publishing ? 'Publishing…' : '🚀 Save & Publish'}
          </button>
          {previewBtn}
          <div className="flex gap-1.5">
            {draftBtn}
            {draftsBtn}
          </div>
          <button
            onClick={saveLocal}
            className="w-full rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 active:scale-[0.99]"
          >
            💾 Save on this device only
          </button>
        </>
      )}

      {/* Preview (working catalog vs published) */}
      {previewOpen && (
        <PublishPreview
          open={previewOpen}
          working={preview?.working ?? catalog}
          published={preview?.published ?? null}
          publishedVersion={preview?.publishedVersion ?? null}
          publishing={publishing}
          onClose={() => setPreviewOpen(false)}
          onPublish={() => {
            // Publish exactly what the preview was showing (working catalog
            // or the DRAFT being previewed).
            const target = preview?.working;
            setPreviewOpen(false);
            void saveAndPublish(target);
          }}
        />
      )}

      {/* Save-as-draft dialog */}
      {saveDraftOpen && (
        <NameDialog
          title="📝 Save to draft"
          caption="Snapshot the current catalog WITHOUT publishing — restore, preview or delete it any time (any admin device)."
          initial=""
          placeholder={`Draft — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          confirmLabel={draftBusy ? 'Saving…' : 'Save draft'}
          busy={draftBusy}
          onCancel={() => setSaveDraftOpen(false)}
          onConfirm={() => void doSaveDraft()}
        />
      )}

      {/* Drafts list (restore = load into working catalog; preview = diff) */}
      <DraftsPanel
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onRestore={(cat, name) => {
          apply(() => cat);
          onToast(`⤴ Draft “${name}” restored — review it, then “Save & Publish” when ready.`);
        }}
        onPreview={(cat, name) => {
          void (async () => {
            const pub = await resolvePublished();
            setPreview({ working: cat, published: pub.catalog, publishedVersion: pub.version, draftName: name });
            setPreviewOpen(true);
          })();
        }}
        toast={onToast}
      />
    </>
  );
}

function Brand({ compact = false, appearance }: { compact?: boolean; appearance?: AppAppearance }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* The admin-set app logo — the console follows its own branding. */}
      <img
        src={appLogoImage(appearance) ?? './icon-512.png'}
        alt=""
        className="h-9 w-9 rounded-xl object-contain"
        width={36}
        height={36}
      />
      <div>
        <h1 className="text-sm font-black uppercase tracking-wide text-slate-900">
          CGPA <span className="text-brand-600">Pilot</span>
        </h1>
        <p className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 ${compact ? '' : 'mt-0.5'}`}>
          Admin Console · v{import.meta.env.VITE_APP_VERSION || 'dev'}
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
