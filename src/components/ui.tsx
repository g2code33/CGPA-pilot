import { useState, type ReactNode } from 'react';

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
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-extrabold text-slate-800">
          {icon && <span className="text-base">{icon}</span>}
          <span className="truncate">{title}</span>
        </h2>
        {info && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={infoLabel ?? 'How to use this'}
            title="How to use / what this means"
            className={`shrink-0 grid h-7 w-7 place-items-center rounded-full text-sm transition ring-1 ${
              open
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-brand-50 text-brand-700 ring-brand-200'
            }`}
          >
            {open ? '✕' : '💡'}
          </button>
        )}
      </div>
      {subtitle && !open && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      {info && open && (
        <div className="mt-2 rounded-xl bg-brand-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-brand-100">
          {info}
        </div>
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
  const [open, setOpen] = useState(false);
  return (
    <div className={`inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label ?? 'Help'}
        title="How to use / what this means"
        className={`inline-flex items-center justify-center rounded-full text-sm transition ring-1 ${
          compact ? 'h-6 w-6 text-xs' : 'h-7 w-7'
        } ${
          open
            ? 'bg-brand-600 text-white ring-brand-600'
            : 'bg-brand-50 text-brand-700 ring-brand-200'
        }`}
      >
        {open ? '✕' : '💡'}
      </button>
      {open && (
        <p
          className={`rounded-xl bg-brand-50/70 text-slate-600 leading-relaxed ring-1 ring-brand-100 ${
            compact ? 'mt-1.5 px-2.5 py-2 text-[11px]' : 'mt-2 px-3 py-2.5 text-xs'
          }`}
        >
          {children}
        </p>
      )}
    </div>
  );
}

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
