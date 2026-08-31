import { useAcademic } from '../state/store';

/** Visible Refresh/Clear control — wipes the temporary in-memory session. */
export function ClearButton({ onClear }: { onClear?: () => void }) {
  const { dispatch } = useAcademic();
  return (
    <button
      onClick={() => {
        if (
          confirm(
            'Clear the cockpit? Everything you entered is temporary and will be removed.'
          )
        ) {
          dispatch({ type: 'reset' });
          onClear?.();
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600 hover:ring-red-200"
      title="Clear everything (nothing is stored)"
    >
      ♻️ <span className="hidden sm:inline">Refresh / Clear</span>
      <span className="sm:hidden">Clear</span>
    </button>
  );
}
