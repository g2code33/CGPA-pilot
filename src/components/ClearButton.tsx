import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAcademic } from '../state/store';
import { markIntentionalReload } from '../services/sessionGuard';
import { wipeDeviceStorage } from '../services/configCache';

/**
 * Persistent 🔄 Refresh / Clear control.
 *
 * Always shows a confirmation modal first — nothing is cleared without
 * explicit approval. On approval the student store is reset to its initial
 * state (wiping CGPA, semester GPAs, courses, targets, scenarios and every
 * derived calculation) and the app is fully reloaded, guaranteeing a clean
 * starting screen with all forms, navigation, scenarios and graphs reset.
 *
 * Curriculum configuration cache is intentionally NOT touched: it contains
 * no personal data and keeps the app working offline.
 */
export function ClearButton() {
  const { dispatch } = useAcademic();
  const [open, setOpen] = useState(false);

  // Escape closes the modal = Cancel; nothing changes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function confirmClear() {
    // 1. Clear all student application state + temporary calculation objects.
    dispatch({ type: 'reset' });
    // 2. Device-storage boundary hook (keeps all storage touches in
    //    configCache.ts). Non-destructive: student work is in-memory (the
    //    reset above + reload wipe it), while the offline curriculum config
    //    and app shell are preserved so no stale seed fallback can appear.
    wipeDeviceStorage();
    // Suppress the beforeunload loss warning for our own intentional reload.
    markIntentionalReload();
    setOpen(false);
    // 4–9. Reload/reinitialize: forms, navigation, scenarios and graphs all
    //      remount from scratch and the clean starting screen shows.
    window.location.reload();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-base text-slate-600 ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600 hover:ring-red-200"
        title="Refresh / Clear — clears your session (nothing is stored)"
        aria-label="Refresh / Clear session"
      >
        🔄
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-session-title"
            onClick={() => setOpen(false)} // backdrop click = Cancel
          >
            <div
              className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-brand-700 to-indigo-800 px-5 py-4 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/15 text-2xl ring-1 ring-white/25">
                  🔄
                </span>
                <h2
                  id="clear-session-title"
                  className="mt-2 text-lg font-black text-white"
                >
                  Clear Your Session?
                </h2>
              </div>

              <div className="px-5 py-4 text-center text-sm leading-relaxed text-slate-600">
                <p>
                  All information currently entered into CGPA PILOT will be
                  cleared.
                </p>
                <p className="mt-1">
                  This includes your CGPA, semester GPAs, targets, projections
                  and What-If calculations.
                </p>
                <p className="mt-1">
                  <strong className="text-slate-800">Nothing is saved or shared.</strong>
                </p>
                <p className="mt-3 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-600 ring-1 ring-red-100">
                  ⚠️ This action cannot be undone.
                </p>
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 ring-1 ring-slate-100">
                  Your temporary calculations are removed from memory and will
                  not come back after the refresh. The offline curriculum
                  configuration (no personal data) stays, so the app keeps
                  working offline.
                </p>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-center sm:gap-3">
                <button
                  onClick={() => setOpen(false)}
                  autoFocus
                  className="w-full rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-200 sm:w-auto sm:min-w-[110px]"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClear}
                  className="w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98] sm:w-auto sm:min-w-[110px]"
                >
                  Yes, clear it
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
