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
import { resolveAssetUrl, safeLogoUrl } from './assets';

export type IconGroup = 'identity' | 'tools' | 'game' | 'admin';

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
  {
    id: 'admin',
    label: 'Admin console',
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
  { id: 'ai', label: 'AI assistant', emoji: '🤖', shape: 'tile', hint: 'The AI button, AI screen header, privacy AI section and the admin AI item', group: 'tools' },
  // Game
  { id: 'plane', label: 'Sky Dash plane', emoji: '🛩️', shape: 'plane', hint: 'The aeroplane you steer in the opening mini-game', group: 'game' },
  { id: 'star', label: 'Collect star', emoji: '⭐', shape: 'circle', hint: 'Stars you catch while flying (Sky Dash)', group: 'game' },
  { id: 'landing', label: 'Landing icon', emoji: '🛬', shape: 'circle', hint: 'Shown when the plane lands and you take off', group: 'game' },
  // Admin console side-menu icons (one slot per console screen).
  { id: 'admin-overview', label: 'Dashboard', emoji: '📊', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-universities', label: 'Institutions', emoji: '🏛️', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-curricula', label: 'Curricula', emoji: '📚', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-grading', label: 'Grading & classes', emoji: '🎯', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-ideatips', label: 'Idea icons', emoji: '💡', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-permissions', label: 'Permissions', emoji: '🔐', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-appearance', label: 'Icons & branding', emoji: '🎨', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-aisettings', label: 'AI assistant', emoji: '🤖', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-aimonitor', label: 'AI monitor', emoji: '🩺', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-storage', label: 'Storage', emoji: '📦', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-recycle', label: 'Recycle bin', emoji: '🗑️', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-previewapp', label: 'Student preview', emoji: '📱', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
  { id: 'admin-testlab', label: 'Test lab', emoji: '🧪', shape: 'tile', hint: 'Admin console side-menu icon', group: 'admin' },
];

/** Slots belonging to a given group (in catalogue order). */
export function slotsByGroup(group: IconGroup): IconSlotDef[] {
  return APP_ICON_SLOTS.filter((s) => s.group === group);
}

/** One place a base icon can render — each adjustable independently. */
export interface IconLocationDef {
  id: string;
  label: string;
  hint: string;
}

/** The location-specific placements admins can adjust per base slot. */
export const ICON_LOCATIONS: IconLocationDef[] = [
  { id: 'tile', label: 'Home tile', hint: 'The icon on the tools grid (mobile home + desktop home).' },
  { id: 'nav', label: 'Sidebar (desktop)', hint: 'The icon in the desktop sidebar navigation.' },
  { id: 'header', label: 'Open-screen header', hint: 'The icon beside the title when the screen is open.' },
  { id: 'fab', label: 'Floating button', hint: 'The floating AI button (bottom-right).' },
  { id: 'quick', label: 'Quick link', hint: 'The small quick-link chip (e.g. inside the AI “no data yet” notice).' },
  { id: 'info', label: 'Info section', hint: 'The matching icon in an explainer/info section (e.g. Privacy → AI).' },
];

/** Which locations a base slot renders in. Empty = single-place icon. */
export function iconLocationsForSlot(id: string): string[] {
  switch (id) {
    case 'calculate':
    case 'target':
    case 'next':
    case 'whatif':
    case 'flight':
    case 'milestones':
      return ['tile', 'nav', 'header', 'quick'];
    case 'privacy':
      return ['tile', 'nav', 'header'];
    case 'ai':
      return ['fab', 'header', 'info'];
    default:
      return [];
  }
}

/** Human label / fallback emoji for a base-or-located slot id. */
function splitSlotId(id: string): { base: string; location: string | null } {
  const i = id.indexOf('.');
  if (i < 0) return { base: id, location: null };
  return { base: id.slice(0, i), location: id.slice(i + 1) };
}

/**
 * The effective icon for a slot, honouring a location-specific override when
 * present and falling back to the base slot (the shared default). This keeps
 * the same default icon everywhere until the admin overrides one location.
 */
export function effectiveSlotIcon(
  appearance: AppAppearance | undefined,
  slot: string,
  location?: string | null
): AppIcon | undefined {
  const { base, location: loc } = splitSlotId(slot);
  const located = location ?? loc;
  if (located) {
    const locatedIcon = appearance?.icons?.[`${base}.${located}`];
    if (locatedIcon) return locatedIcon;
  }
  return appearance?.icons?.[base];
}

/** Resolve the effective icon for a slot given the optional appearance. */
export function slotIcon(appearance: AppAppearance | undefined, id: string): AppIcon | undefined {
  return effectiveSlotIcon(appearance, id);
}

/** A slot's default definition (by base or located id). */
export function slotDef(id: string): IconSlotDef | undefined {
  return APP_ICON_SLOTS.find((s) => s.id === splitSlotId(id).base);
}

/** Fallback emoji for a slot (base or located id). */
export function slotFallback(id: string): string {
  return APP_ICON_SLOTS.find((s) => s.id === splitSlotId(id).base)?.emoji ?? '•';
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
  const logo = appLogoImage(appearance); // resolved: data URL or /api/assets/… URL
  if (!logo) return;
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) return;
  // Only data URLs carry a known type; for asset references let the browser
  // sniff from the served content-type (we set it on the Worker response).
  if (logo.startsWith('data:')) {
    link.setAttribute(
      'type',
      logo.startsWith('data:image/jpeg') || logo.startsWith('data:image/jpg') ? 'image/jpeg' : 'image/png'
    );
  } else {
    link.removeAttribute('type');
  }
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
  return safeLogoUrl(appearance?.logo, appearance?.appIcon?.image);
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

/** Font families the admin can pick for the wordmark / tagline. */
export const BRAND_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'system', label: 'System (default)', stack: '' },
  { id: 'sans', label: 'Sans (Arial)', stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { id: 'serif', label: 'Serif (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono (Courier)', stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace" },
  { id: 'rounded', label: 'Rounded (Trebuchet)', stack: "'Trebuchet MS', Verdana, 'Segoe UI', sans-serif" },
];

/** The CSS font stack for an admin-picked font key ('' = the app default). */
export function brandFontStack(id: string | undefined): string {
  return BRAND_FONTS.find((f) => f.id === id)?.stack ?? '';
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
  // resolveAssetUrl: data URL (legacy) as-is, asset:<key> → Worker URL (R2).
  const src = resolveAssetUrl(icon?.image);
  if (src) {
    const sizePx =
      typeof icon?.size === 'number' && Number.isFinite(icon.size) && icon.size > 0 ? icon.size : undefined;
    return { type: 'img', src, alt: icon?.emoji ? `custom icon (${icon.emoji})` : 'custom icon', cls, sizePx };
  }
  return { type: 'emoji', text: icon?.emoji || fallbackEmoji, cls };
}
