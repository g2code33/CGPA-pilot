import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence against a white screen: any render error anywhere in
 * the student app lands here and shows a friendly, recoverable card instead
 * of unmounting the whole tree into a blank page. The error is logged to the
 * console (with component stack) so it can be diagnosed.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CGPA Pilot UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-[100dvh] place-items-center bg-slate-50 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <p className="text-3xl">🛩️</p>
            <h1 className="mt-2 text-base font-black text-slate-800">
              Something went off course
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              This screen hit an unexpected error. Your results are safe on
              this device — reload to pick up exactly where you left off.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-brand-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-brand-700 active:scale-[0.98]"
            >
              Reload the app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
