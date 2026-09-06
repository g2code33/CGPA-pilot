// ─────────────────────────────────────────────────────────────────────────
// appDialog — the app's OWN browser-safe dialogs.
//
// Replaces native `alert()` / `confirm()` (which render as ugly browser
// chrome: "cgpapilot.pages.dev says …") with one styled in-app modal that
// matches the rest of CGPA PILOT. Both the student app and the admin console
// mount <AppDialogProvider/> at their root, then any code can call the
// module-level `appAlert()` / `appConfirm()` helpers — no hook plumbing at
// every call site.
//
// Fallback (provider not mounted, or called before mount) never uses blocking
// native dialogs: it resolves safely and logs a warning so the missing
// provider is easy to spot.
// ─────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface AppConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface AppDialogApi {
  alertDialog(message: string, title?: string): Promise<void>;
  confirmDialog(opts: AppConfirmOptions): Promise<boolean>;
}

interface PromptState {
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const DialogContext = createContext<AppDialogApi | null>(null);

let dispatchAlert: ((message: string, title?: string) => Promise<void>) | null = null;
let dispatchConfirm: ((opts: AppConfirmOptions) => Promise<boolean>) | null = null;

/**
 * In-app replacement for `window.alert()`. Resolves when the student/admin
 * closes the dialog.
 */
export function appAlert(message: string, title = 'Notice'): Promise<void> {
  if (dispatchAlert) return dispatchAlert(message, title);
  // eslint-disable-next-line no-console
  console.warn('[appDialog] appAlert called before AppDialogProvider mounted.', message);
  return Promise.resolve();
}

/**
 * In-app replacement for `window.confirm()`. Resolves `true` on Confirm and
 * `false` on Cancel / backdrop / Escape.
 */
export function appConfirm(opts: string | AppConfirmOptions): Promise<boolean> {
  const o = typeof opts === 'string' ? { message: opts } : opts;
  if (dispatchConfirm) return dispatchConfirm(o);
  // eslint-disable-next-line no-console
  console.warn('[appDialog] appConfirm called before AppDialogProvider mounted.', o.message);
  return Promise.resolve(false);
}

export function useAppDialog(): AppDialogApi {
  const api = useContext(DialogContext);
  if (api) return api;
  return {
    alertDialog: appAlert,
    confirmDialog: appConfirm,
  };
}

/** Mount once at the app/admin root. Renders the in-app modal when active. */
export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const promptRef = useRef<PromptState | null>(null);

  const open = useCallback(
    (p: Omit<PromptState, 'resolve'>): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A new dialog while one is open: close the previous as cancelled.
        if (promptRef.current) promptRef.current.resolve(false);
        const next: PromptState = { ...p, resolve };
        promptRef.current = next;
        setPrompt(next);
      }),
    []
  );

  const close = useCallback((ok: boolean) => {
    const current = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    current?.resolve(ok);
  }, []);

  useEffect(() => {
    dispatchAlert = (message, title) =>
      open({ kind: 'alert', title: title ?? 'Notice', message }).then(() => undefined);
    dispatchConfirm = (opts) =>
      open({
        kind: 'confirm',
        title: opts.title ?? 'Please confirm',
        message: opts.message,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        danger: opts.danger,
      });
    return () => {
      dispatchAlert = null;
      dispatchConfirm = null;
      if (promptRef.current) {
        promptRef.current.resolve(false);
        promptRef.current = null;
      }
    };
  }, [open]);

  // Escape closes as cancel (never applies a destructive action by accident).
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(prompt.kind === 'alert');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, close]);

  return (
    <DialogContext.Provider value={{ alertDialog: appAlert, confirmDialog: appConfirm }}>
      {children}
      {prompt && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => close(prompt.kind === 'alert')}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg ${
                  prompt.danger ? 'bg-red-50' : 'bg-brand-50'
                }`}
              >
                {prompt.danger ? '⚠️' : prompt.kind === 'alert' ? '💬' : '❓'}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-slate-900">{prompt.title}</h2>
                <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-slate-600">
                  {prompt.message}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {prompt.kind === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
                >
                  {prompt.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                onClick={() => close(true)}
                autoFocus
                className={`rounded-xl px-4 py-2.5 text-xs font-black text-white shadow-sm transition active:scale-[0.99] ${
                  prompt.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-brand-600 hover:bg-brand-700'
                }`}
              >
                {prompt.confirmLabel ?? (prompt.kind === 'alert' ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
