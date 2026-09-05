// ─────────────────────────────────────────────────────────────────────────
// Idea Icons — admin control for the small 💡 hint icons that sit next to
// the student app's calculated result boxes.
//   • ON/OFF lives in the Permissions section (the shared student
//     permissions registry) — this page shows the state
//   • reword: edit the exact sentence each icon shows (blank = hide just
//     that one)
// Changes ride the published config (settings.ideaTips) — they go live on
// every device after Save & Publish, and the app keeps working offline.
// ─────────────────────────────────────────────────────────────────────────

import { useAdmin } from '../adminStore';
import { IDEA_TIPS, IDEA_TIP_PAGES } from '../../infoTips';

export function IdeaIcons() {
  const { catalog, apply } = useAdmin();
  const ideaTips = catalog.settings?.ideaTips;
  const enabled = ideaTips?.enabled !== false;
  const texts = ideaTips?.texts ?? {};
  const overrideCount = Object.keys(texts).length;

  const setText = (key: string, value: string) =>
    apply((c) => {
      // The sentence is stored as typed — an EMPTY string means "hide just
      // this icon" (the default sentence comes back only via ↺ reset).
      const t = { ...(c.settings?.ideaTips?.texts ?? {}), [key]: value };
      return {
        ...c,
        settings: {
          ...c.settings,
          ideaTips: { enabled: c.settings?.ideaTips?.enabled, texts: t },
        },
      };
    });

  const resetText = (key: string) =>
    apply((c) => {
      const t = { ...(c.settings?.ideaTips?.texts ?? {}) };
      delete t[key];
      return {
        ...c,
        settings: { ...c.settings, ideaTips: { ...c.settings?.ideaTips, texts: t } },
      };
    });

  const resetAll = () =>
    apply((c) => ({
      ...c,
      settings: {
        ...c.settings,
        ideaTips: { enabled: c.settings?.ideaTips?.enabled },
      },
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-slate-900">💡 Idea Icons</h2>
        {overrideCount > 0 && (
          <button
            onClick={resetAll}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
          >
            ↺ Reset all sentences
          </button>
        )}
      </div>

      {/* On/off state — the toggle itself lives in the Permissions section */}
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl p-4 shadow-sm ring-1 ${
          enabled ? 'bg-white ring-slate-200' : 'bg-amber-50 ring-amber-200'
        }`}
      >
        <div>
          <h3 className="text-sm font-bold text-slate-800">
            Idea icons are {enabled ? 'ON' : 'OFF'} in the student app
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {enabled
              ? 'To hide every 💡, turn the switch off in the Permissions section.'
              : 'Students see no 💡 icons. Turn the switch back on in the Permissions section.'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${
            enabled ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-100 text-amber-700 ring-amber-300'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Sentences */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <h3 className="text-sm font-bold text-slate-800">What each icon says</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Edit a sentence to change what students see. Leave one empty to hide just that icon.
        </p>
        <div className="mt-3 space-y-4">
          {IDEA_TIP_PAGES.map((page) => (
            <div key={page}>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-600">
                {page}
              </p>
              <div className="mt-1.5 space-y-1.5">
                {IDEA_TIPS.filter((t) => t.page === page).map((t) => {
                  const custom = texts[t.key];
                  const overridden = custom !== undefined && custom.trim() !== '' && custom !== t.text;
                  const cleared = custom !== undefined && custom.trim() === '';
                  return (
                    <div
                      key={t.key}
                      className="flex flex-col gap-1 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200 sm:flex-row sm:items-center"
                    >
                      <span
                        className={`shrink-0 text-[11px] font-bold sm:w-44 ${
                          cleared ? 'text-slate-400 line-through' : 'text-slate-700'
                        }`}
                      >
                        {t.subject}
                        {cleared && ' · hidden'}
                      </span>
                      <input
                        type="text"
                        value={custom ?? t.text}
                        onChange={(e) => setText(t.key, e.target.value)}
                        className="input w-full flex-1 py-1.5 text-xs"
                      />
                      {(overridden || cleared) && (
                        <button
                          onClick={() => resetText(t.key)}
                          title="Back to the default sentence"
                          className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
