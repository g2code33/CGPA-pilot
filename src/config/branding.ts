// ─────────────────────────────────────────────────────────────────────────
// branding — shared, non-personal icon/appearance helpers.
//
// The admin "Icon manager" and the student app both use the SAME slot
// catalogue, so an icon the administrator overrides in the console is the exact
// icon the student app then renders — everywhere, including the opening
// Sky Dash mini-game aeroplane. This module contains no storage calls and no
// personal data — it only reads the admin-supplied appearance object passed in
// (which rides the non-personal config document).
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance, AppIcon } from './types';

export type IconGroup = 'identity' | 'tools' | 'game';

/** One editable app-icon slot the admin can customise. */
export interface IconSlotDef {
  /** Stable key stored under AppAppearance.icons[slot.id]. */
  id: string;
  /** Human label shown in the admin manager. */
  label: string;
  /** Default emoji shown when the admin has not overridden this slot. */
  emoji: string;
  /** Rendered preview shape the icon appears in across the app. */
  shape?: 'circle' | 'tile' | 'plane';
  hint: string;
  /** Which section of the icon manager this belongs to. */
  group: IconGroup;
}

/** Icon-manager section order + labels. */
export const ICON_GROUPS: { id: IconGroup; label: string }[] = [
  {
    id: 'identity',
    label: 'App identity',
  },
  {
    id: 'tools',
    label: 'Tools & screens',
  },
  {
    id: 'game',
    label: 'Splash & game',
  },
];

/**
 * The full icon slots the student app actually renders — every branded glyph,
 * including the Sky Dash aeroplane. Keep ids in sync with where the student
 * app reads them.
 */
export const APP_ICON_SLOTS: IconSlotDef[] = [
  // Tools
  { id: 'calculate', label: 'My results', emoji: '🧮', shape: 'tile', hint: 'Grade entry & your CGPA standing', group: 'tools' },
  { id: 'target', label: 'Target', emoji: '🎯', shape: 'tile', hint: 'Goal reachability planner', group: 'tools' },
  { id: 'next', label: 'Next Semester', emoji: '▶️', shape: 'tile', hint: 'Grades needed to stay on track', group: 'tools' },
  { id: 'whatif', label: 'What-If', emoji: '🔀', shape: 'tile', hint: 'Future-GPA simulator', group: 'tools' },
  { id: 'flight', label: 'Flight Path', emoji: '🛩️', shape: 'tile', hint: 'Route to graduation', group: 'tools' },
  { id: 'milestones', label: 'Milestones', emoji: '🏁', shape: 'tile', hint: 'Stage checkpoints', group: 'tools' },
  { id: 'privacy', label: 'Privacy', emoji: '🔒', shape: 'tile', hint: 'Privacy explanation', group: 'tools' },
  // Game
  { id: 'plane', label: 'Sky Dash plane', emoji: '🛩️', shape: 'plane', hint: 'The aeroplane you steer in the opening mini-game', group: 'game' },
  { id: 'star', label: 'Collect star', emoji: '⭐', shape: 'circle', hint: 'Stars you catch while flying (Sky Dash)', group: 'game' },
  { id: 'landing', label: 'Landing icon', emoji: '🛬', shape: 'circle', hint: 'Shown when the plane lands and you take off', group: 'game' },
];

/** Slots belonging to a given group (in catalogue order). */
export function slotsByGroup(group: IconGroup): IconSlotDef[] {
  return APP_ICON_SLOTS.filter((s) => s.group === group);
}

/** Resolve the effective icon for a slot given the optional appearance. */
export function slotIcon(appearance: AppAppearance | undefined, id: string): AppIcon | undefined {
  return appearance?.icons?.[id];
}

/** A slot's default definition (by id). */
export function slotDef(id: string): IconSlotDef | undefined {
  return APP_ICON_SLOTS.find((s) => s.id === id);
}

/** Fallback emoji for a slot (used when no override is set). */
export function slotFallback(id: string): string {
  return APP_ICON_SLOTS.find((s) => s.id === id)?.emoji ?? '•';
}

/**
 * The display glyph for an icon — the uploaded image when one is supplied,
 * otherwise the emoji fallback.
 */
export function iconGlyph(icon: AppIcon | undefined, fallbackEmoji: string): string {
  if (!icon) return fallbackEmoji;
  return icon.image || icon.emoji || fallbackEmoji;
}

/**
 * Point the browser tab icon at the admin-set app logo (data URL) so the
 * "preview in the web browser" matches the branding. Keeps the bundled
 * icon when the admin has not set a logo (or on non-browser runtimes).
 */
export function applyBrandFavicon(appearance: AppAppearance | undefined): void {
  if (typeof document === 'undefined') return;
  const logo = appLogoImage(appearance);
  if (!logo) return;
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) return;
  link.setAttribute(
    'type',
    logo.startsWith('data:image/jpeg') || logo.startsWith('data:image/jpg') ? 'image/jpeg' : 'image/png'
  );
  link.setAttribute('href', logo);
}

/** Default product wordmark when the admin has not overridden it. */
export const DEFAULT_APP_NAME = 'CGPA Pilot';
export const DEFAULT_TAGLINE = 'Navigate Your Academic Future.';

/**
 * The app logo image to display: the admin's full app-logo image, else the app
 * icon image, else undefined (callers then fall back to the appIcon emoji or
 * the bundled ./icon-512.png).
 */
export function appLogoImage(appearance: AppAppearance | undefined): string | undefined {
  return appearance?.logo ?? appearance?.appIcon?.image;
}

/**
 * App logo for print sheets: the admin-uploaded logo, or the bundled default
 * so every printout always carries the app mark.
 */
export function printAppLogo(appearance: AppAppearance | undefined): string {
  return appLogoImage(appearance) ?? 'icon-512.png';
}

/** The app-name wordmark the admin set, or the default. */
export function appName(appearance: AppAppearance | undefined): string {
  return appearance?.appName?.trim() || DEFAULT_APP_NAME;
}

/** The tagline the admin set, or the default. */
export function tagline(appearance: AppAppearance | undefined): string {
  return appearance?.tagline?.trim() || DEFAULT_TAGLINE;
}

/**
 * Rendered markup for an icon: an <img> when the admin uploaded an image,
 * otherwise the emoji text. Used by components that show the icon.
 */
export function iconElement(
  icon: AppIcon | undefined,
  fallbackEmoji: string,
  cls = ''
): { type: 'img' | 'emoji'; src?: string; alt?: string; text?: string; cls?: string; sizePx?: number } {
  const src = icon?.image;
  if (src) {
    const sizePx =
      typeof icon?.size === 'number' && Number.isFinite(icon.size) && icon.size > 0 ? icon.size : undefined;
    return { type: 'img', src, alt: icon?.emoji ? `custom icon (${icon.emoji})` : 'custom icon', cls, sizePx };
  }
  return { type: 'emoji', text: icon?.emoji || fallbackEmoji, cls };
}
