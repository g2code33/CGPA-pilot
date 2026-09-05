import { iconElement } from '../config/branding';
import type { AppAppearance } from '../config/types';

/**
 * Renders one administrator-customisable icon slot.
 *
 * - If the admin uploaded an image for the slot, an <img> is shown.
 * - Otherwise the slot's emoji (or the given fallback) is shown as text.
 *
 * This single component is what the student app and the admin "Student
 * preview" both use, so a branding change is reflected identically everywhere.
 */
export function AppGlyph({
  appearance,
  slot,
  fallback,
  size = 24,
  className = '',
  imgClassName,
}: {
  appearance?: AppAppearance;
  /** Appearance.icons key (also accepts 'appIcon'). */
  slot: string;
  /** Fallback emoji used when the slot has no override. */
  fallback: string;
  /** Size in px for both image and emoji. */
  size?: number;
  /** Extra classes for the outer element. */
  className?: string;
  /** Extra classes for the <img> when an image override is used. */
  imgClassName?: string;
}) {
  const icon = slot === 'appIcon' ? appearance?.appIcon : appearance?.icons?.[slot];
  const el = iconElement(icon, fallback);
  if (el.type === 'img') {
    const px = el.sizePx ?? size;
    return (
      <img
        src={el.src}
        alt={el.alt ?? 'icon'}
        width={px}
        height={px}
        className={`object-contain ${imgClassName ?? ''} ${className}`}
      />
    );
  }
  return (
    <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
      {el.text}
    </span>
  );
}
