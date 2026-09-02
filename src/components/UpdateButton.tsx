import { useEffect, useState } from 'react';
import type { UpdaterStatus } from '../desktop';

/**
 * Manual "check for updates" control, placed at the top of the app.
 * Desktop (Electron): drives the built-in auto-updater.
 * Web/PWA: checks the service worker for a new waiting app shell.
 */

type Phase = 'idle' | 'checking' | 'updated' | 'downloading' | 'ready' | 'error' | 'latest';

async function waitingWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.waiting ?? null;
}

function listenForWaitingWorker(onReady: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  let cleanup = () => {};
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;
    if (reg.waiting) {
      onReady();
      return;
    }
    const onInstalling = () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) onReady();
      });
    };
    reg.addEventListener('updatefound', onInstalling);
    cleanup = () => reg.removeEventListener('updatefound', onInstalling);
  });
  return () => cleanup();
}

export function UpdateButton() {
  const desktop = typeof window !== 'undefined' && !!window.cgpaPilot;
  const webUpdateSupported =
    typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD;

  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState('');
  const [percent, setPercent] = useState(0);
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (!window.cgpaPilot) return;
    const unsub = window.cgpaPilot.onUpdaterStatus((s: UpdaterStatus) => {
      setVersion(s.version ?? '');
      switch (s.status) {
        case 'checking':
          setPhase('checking');
          break;
        case 'downloading':
          setPhase('downloading');
          setPercent(Math.round(s.percent ?? 0));
          break;
        case 'downloaded':
          setPhase('ready');
          break;
        case 'available':
          setPhase('updated');
          break;
        case 'error':
          setPhase('error');
          setDetail(s.message ?? 'Update check failed');
          break;
        case 'unavailable':
          setPhase((p) => (p === 'checking' ? 'latest' : p));
          break;
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!webUpdateSupported || desktop) return;
    const stop = listenForWaitingWorker(() => setPhase('ready'));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check() {
    setDetail('');
    if (desktop) {
      setPhase('checking');
      try {
        const s = await window.cgpaPilot!.checkForUpdates();
        if (s.status === 'unavailable') setPhase('latest');
        else if (s.status === 'error') {
          setPhase('error');
          setDetail(s.message ?? 'Update check failed');
        }
      } catch {
        setPhase('error');
        setDetail('Could not reach the update server');
      }
      return;
    }
    if (webUpdateSupported) {
      setPhase('checking');
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) {
          setPhase('latest');
          return;
        }
        await reg.update();
        const waiting = await waitingWorker();
        if (waiting) {
          setPhase('ready');
        } else {
          await new Promise((r) => setTimeout(r, 1500));
          setPhase((await waitingWorker()) ? 'ready' : 'latest');
        }
      } catch {
        setPhase('latest');
      }
      return;
    }
    setPhase('latest');
  }

  async function download() {
    if (desktop) {
      setPhase('downloading');
      const res = await window.cgpaPilot?.downloadUpdate();
      if (res && !res.ok) {
        setPhase('error');
        setDetail(res.message ?? 'Download failed');
      }
    }
  }

  function restart() {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    if ('caches' in window) { caches.keys().then((names) => { names.forEach((name) => caches.delete(name)); }).catch(() => {}); }
    if (desktop) window.cgpaPilot?.installUpdate();
    else window.location.reload();
  }

  if (phase === 'ready') {
    return (
      <button
        type="button"
        onClick={restart}
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-green-700"
        title="Restart to install the latest version"
      >
        ✅ Restart to update {version && <span className="opacity-90">v{version}</span>}
      </button>
    );
  }

  if (phase === 'updated' && desktop) {
    return (
      <button
        type="button"
        onClick={download}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700"
        title={`Update v${version} available — download and install`}
      >
        🔄 Update available {version && <span className="opacity-90">v{version}</span>}
      </button>
    );
  }

  if (phase === 'downloading') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-100 px-3 py-1.5 text-xs font-bold text-brand-800">
        ⬇️ Downloading… {percent}%
      </span>
    );
  }

  if (phase === 'checking') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
        ⏳ Checking…
      </span>
    );
  }

  const showLatest = phase === 'latest';
  return (
    <button
      type="button"
      onClick={check}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold shadow-sm transition ${
        phase === 'error'
          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
          : showLatest
            ? 'bg-slate-100 text-emerald-700 hover:bg-slate-200'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
      title={phase === 'error' ? detail : 'Check for updates'}
    >
      {phase === 'error'
        ? '⚠️ Update check failed — retry'
        : showLatest
          ? '✓ You’re up to date'
          : '⟳ Check for updates'}
    </button>
  );
}
