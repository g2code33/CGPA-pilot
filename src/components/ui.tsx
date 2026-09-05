import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';

interface PopPos {
  top: number;
  left: number;
  above: boolean;
}

/**
 * Shared idea-popover state: the panel is rendered with `position: fixed`
 * from the button's viewport rect, so it overlays whatever is on screen
 * (card, table, scroll container) without being clipped and without ever
 * extending the layout. It flips above the button when the bottom edge is
 * close, and closes on scroll/resize so it can never drift.
 */
function usePopover(width: number, align: 'center' | 'right' = 'center') {
  const [pos, setPos] = useState<PopPos | null>(null);
  const open = pos !== null;

  const toggle = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      setPos((prev) => {
        if (prev) return null;
        const r = e.currentTarget.getBoundingClientRect();
        const margin = 8;
        const w = Math.min(width, window.innerWidth - margin * 2);
        let left = align === 'right' ? r.right - w : r.left + r.width / 2 - w / 2;
        left = Math.min(window.innerWidth - w - margin, Math.max(margin, left));
        const above = window.innerHeight - r.bottom < 140;
        return { top: above ? r.top - 6 : r.bottom + 6, left, above };
      });
    },
    [align, width]
  );

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return { open, pos, toggle };
}

function PopoverPanel({
  pos,
  width,
  className = '',
  children,
}: {
  pos: PopPos;
  width: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`fixed z-[100] rounded-xl bg-slate-900/95 text-slate-100 leading-relaxed shadow-xl ring-1 ring-white/10 ${
        pos.above ? '-translate-y-full' : ''
      } ${className}`}
      style={{ top: pos.top, left: pos.left, width, maxWidth: 'calc(100vw - 16px)' }}
    >
      {children}
    </div>
  );
}

/** The round 💡 button shared by every idea popover in the app. */
function IdeaButton({
  open,
  onClick,
  label,
  compact = false,
}: {
  open: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      title="How to use / what this means"
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-sm transition ring-1 ${
        compact ? 'h-6 w-6 text-xs' : 'h-7 w-7'
      } ${
        open
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-brand-50 text-brand-700 ring-brand-200'
      }`}
    >
      {open ? '✕' : '💡'}
    </button>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({
  icon,
  title,
  subtitle,
  info,
  infoLabel,
}: {
  icon?: string;
  title: string;
  subtitle?: ReactNode;
  /** Longer "how to use / what does this mean" help, shown behind the info icon. */
  info?: ReactNode;
  infoLabel?: string;
}) {
  const pop = usePopover(288, 'right');
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-extrabold text-slate-800">
          {icon && <span className="text-base">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {info && <IdeaButton open={pop.open} onClick={pop.toggle} label={infoLabel ?? 'How to use this'} />}
      </div>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      {pop.pos && info && (
        <PopoverPanel pos={pop.pos} width={288} className="px-3 py-2.5 text-xs">
          {info}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * Standalone idea/help icon. Tap to reveal an explanation beneath it. Useful
 * next to status boxes or standalone disclaimers that would otherwise be a
 * wall of text on small screens.
 */
export function Info({
  children,
  label,
  className = '',
  compact = false,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  /** Smaller button + tighter popover, for use inside small stat boxes. */
  compact?: boolean;
}) {
  const width = compact ? 176 : 256;
  const pop = usePopover(width, 'center');
  return (
    <div className={`inline-block ${className}`}>
      <IdeaButton open={pop.open} onClick={pop.toggle} label={label ?? 'Help'} compact={compact} />
      {pop.pos && (
        <PopoverPanel
          pos={pop.pos}
          width={width}
          className={compact ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2.5 text-xs'}
        >
          {children}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * 💡 Idea icon for a calculated result. Renders NOTHING when `tip` is
 * empty/undefined — the admin can switch all idea icons off or clear a
 * single sentence, and the icon simply disappears (no empty popover).
 */
export function TipIcon({ tip, label }: { tip?: string | null; label?: string }) {
  if (!tip) return null;
  return <Info compact label={label}>{tip}</Info>;
}

/**
 * Standard table header cell: uppercase micro-label + a small 💡 idea icon
 * (admin-controlled; renders nothing when the tip is off or cleared).
 * Every table in the app uses this so column meanings are always reachable.
 */
export function Th({
  label,
  tip,
  right = false,
  className = '',
}: {
  label: string;
  tip?: string;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500 ${
        right ? 'text-right' : 'text-left'
      } ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        <TipIcon tip={tip} label={`About: ${label}`} />
      </span>
    </th>
  );
}

/** Shared look for every data table in the app. */
export const tableStyles = {
  wrap: 'overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200',
  table: 'w-full text-left text-xs',
  headRow: 'border-b-2 border-slate-200 bg-slate-50/90',
  row: 'border-b border-slate-100 transition-colors last:border-b-0 hover:bg-brand-50/50',
  cell: 'px-3 py-2',
};

const TONE_CLASSES: Record<string, string> = {
  gold: 'bg-amber-100 text-amber-800 ring-amber-300',
  green: 'bg-green-100 text-green-700 ring-green-300',
  teal: 'bg-teal-100 text-teal-700 ring-teal-300',
  blue: 'bg-sky-100 text-sky-700 ring-sky-300',
  amber: 'bg-amber-100 text-amber-800 ring-amber-300',
  orange: 'bg-orange-100 text-orange-700 ring-orange-300',
  red: 'bg-red-100 text-red-700 ring-red-300',
  gray: 'bg-slate-100 text-slate-600 ring-slate-300',
};

export function Badge({
  tone = 'gray',
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
        TONE_CLASSES[tone] ?? TONE_CLASSES.gray
      }`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-black text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
      {children}
    </p>
  );
}

/**
 * Collapsible block for keeping heavy content (graphs, long tables) compact on
 * small screens. Collapsed by default to reduce scrolling.
 */
export function Collapse({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-slate-50 px-3 py-2 text-left text-xs font-extrabold text-slate-700 transition active:bg-slate-100"
      >
        <span>{label}</span>
        <span className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && <div className="bg-white p-3">{children}</div>}
    </div>
  );
}
