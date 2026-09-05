import type { CSSProperties } from 'react';
import { appName, brandFontStack, tagline } from '../config/branding';
import type { AppAppearance, TextBrandStyle } from '../config/types';

/**
 * Merge an admin text style over the surface's defaults. An unset field
 * keeps the surface default, so a fresh install looks exactly as before.
 */
function styleFrom(s: TextBrandStyle | undefined, baseSize: number, baseColor?: string, applyColor = true): CSSProperties {
  const st: CSSProperties = { fontSize: s?.fontSize ?? baseSize };
  if (applyColor && s?.color) st.color = s.color;
  else if (baseColor) st.color = baseColor;
  const font = brandFontStack(s?.fontFamily);
  if (font) st.fontFamily = font;
  return st;
}

/**
 * The app wordmark. Renders the admin's wordmark IMAGE when one is set,
 * otherwise the app name text (default "CGPA Pilot") with the admin's
 * font size / colour / type. `size` and `color` are the SURFACE defaults
 * used when the admin has not set them (hero vs compact header); the
 * weight comes via `className` (font-black / font-extrabold).
 */
export function Wordmark({
  appearance,
  size = 36,
  color,
  accent = false,
  accentClass = 'text-brand-300',
  applyColor = true,
  className = '',
}: {
  appearance?: AppAppearance;
  /** Default text size in px (surface-specific). */
  size?: number;
  /** Default text colour (surface-specific); the admin colour wins. */
  color?: string;
  /** Default "CGPA <accent>Pilot</accent>" two-tone (brand default only). */
  accent?: boolean;
  /** Tailwind class for the accent word (300 on dark, 600 on light). */
  accentClass?: string;
  /** false = the surface keeps its own colour (e.g. the light app header). */
  applyColor?: boolean;
  className?: string;
}) {
  const s = appearance?.appNameStyle;
  const img = appearance?.appImage;
  if (img) {
    return (
      <img
        src={img}
        alt={appName(appearance)}
        className={`object-contain ${className}`}
        style={{ height: s?.fontSize ?? (size >= 24 ? 40 : 20), width: 'auto', maxWidth: 340 }}
      />
    );
  }
  const custom = appearance?.appName?.trim();
  return (
    <span className={`tracking-tight ${className}`} style={styleFrom(s, size, color, applyColor)}>
      {custom ? (
        custom
      ) : (
        <>
          CGPA{' '}
          {accent && !s?.color ? <span className={accentClass}>Pilot</span> : 'Pilot'}
        </>
      )}
    </span>
  );
}

/**
 * The admin tagline — shown on the opening screen. Renders the admin's
 * tagline image when set, otherwise the tagline text with the admin's
 * font size / colour / type (defaults suit the dark opening screen).
 */
export function Tagline({
  appearance,
  size = 16,
  color = 'rgba(255,255,255,0.9)',
  className = '',
}: {
  appearance?: AppAppearance;
  size?: number;
  color?: string;
  className?: string;
}) {
  const s = appearance?.taglineStyle;
  const img = appearance?.taglineImage;
  if (img) {
    return (
      <img
        src={img}
        alt=""
        className={`object-contain ${className}`}
        style={{ height: s?.fontSize ?? 18, width: 'auto', maxWidth: 280 }}
      />
    );
  }
  return (
    <span className={`font-medium ${className}`} style={styleFrom(s, size, color)}>
      {tagline(appearance)}
    </span>
  );
}
