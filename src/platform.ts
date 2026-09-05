// ─────────────────────────────────────────────────────────────────────────
// platform — which client is running the app, and which VIEW it should use.
//
// The app is designed mobile-first (the view most students use). Every
// client gets the view it is best served by:
//
//   • Electron (Windows .exe / Linux .deb / .AppImage) → DESKTOP view
//   • Capacitor Android APK / iOS app                 → MOBILE view
//   • Browser web / PWA                               → auto-detect:
//     wide fine-pointer screens (laptops, desktops) get the DESKTOP view,
//     phones/tablets get the MOBILE view — and it re-evaluates on resize.
//
// This module is UI-agnostic (no React render logic in platformKind());
// useViewMode() is the React hook that keeps the web detection live.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export type PlatformKind = 'electron' | 'android' | 'ios' | 'web';
export type ViewMode = 'mobile' | 'desktop';

/**
 * The client this build is running in.
 *  - `window.cgpaPilot`  → Electron (the preload bridge only exists there)
 *  - `window.Capacitor`  → native mobile (Android / iOS by user agent)
 *  - otherwise           → browser web / PWA
 */
export function platformKind(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  if (window.cgpaPilot) return 'electron';
  if (window.Capacitor?.isNativePlatform?.()) {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod|iOS/i.test(ua) ? 'ios' : 'android';
  }
  return 'web';
}

function webViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'desktop';
  const wide = window.matchMedia('(min-width: 1024px)');
  const coarse = window.matchMedia('(pointer: coarse)');
  // Wide + fine pointer (mouse/trackpad) = a PC screen. Phones and tablets
  // (coarse pointer) keep the mobile view even in landscape.
  return wide.matches && !coarse.matches ? 'desktop' : 'mobile';
}

/** The view this client should use, computed once (no React). */
export function viewMode(): ViewMode {
  const kind = platformKind();
  if (kind === 'electron') return 'desktop'; // deb / Windows → PC view
  if (kind === 'android' || kind === 'ios') return 'mobile'; // APK / iOS → mobile view
  return webViewMode(); // web → detect the device
}

/**
 * React hook: the live view mode. For native clients it is constant
 * (Android/iOS = mobile, Electron = desktop); for web it follows the
 * screen size so rotating a phone or resizing a window switches views.
 */
export function useViewMode(): ViewMode {
  const kind = platformKind();
  const [mode, setMode] = useState<ViewMode>(() =>
    kind === 'web' ? webViewMode() : kind === 'electron' ? 'desktop' : 'mobile'
  );

  useEffect(() => {
    if (kind !== 'web' || typeof window === 'undefined') return;
    const wide = window.matchMedia('(min-width: 1024px)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const update = () => setMode(wide.matches && !coarse.matches ? 'desktop' : 'mobile');
    update();
    wide.addEventListener('change', update);
    coarse.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      coarse.removeEventListener('change', update);
    };
  }, [kind]);

  return mode;
}
