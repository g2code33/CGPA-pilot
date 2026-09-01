import type { ReactNode } from 'react';

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
}: {
  icon: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
        <span className="text-base">{icon}</span>
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
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
