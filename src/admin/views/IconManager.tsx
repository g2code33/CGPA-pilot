import { useRef, useState } from 'react';
import { useAdmin } from '../adminStore';
import { setAppearance } from '../adminConfigService';
import type { AppAppearance, AppIcon } from '../../config/types';
import {
  DEFAULT_APP_NAME,
  DEFAULT_TAGLINE,
  ICON_GROUPS,
  iconElement,
  slotsByGroup,
  type IconGroup,
} from '../../config/branding';
import { readImageFile } from '../appearanceEdit';

export function IconManager() {
  const { catalog, apply } = useAdmin();
  const [toast, setToast] = useState<string | null>(null);
  const appearance = catalog.appearance;

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function commit(patch: (a: AppAppearance) => AppAppearance) {
    apply((c) => setAppearance(c, patch(c.appearance ?? {})));
  }

  const name = appearance?.appName?.trim() ?? DEFAULT_APP_NAME;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">Icons &amp; branding</h1>
      </header>

      {toast && (
        <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white">
          {toast}
        </div>
      )}

      {/* ── App identity ─────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
        <SectionTitle title="App identity" />

        {/* Wordmark */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">App name (wordmark)</span>
            <input
              className="input w-full font-bold"
              value={name === DEFAULT_APP_NAME && !appearance?.appName ? '' : name}
              placeholder={DEFAULT_APP_NAME}
              onChange={(e) => commit((a) => ({ ...a, appName: e.target.value || undefined }))}
            />
          </label>
          <label className="block">
            <span className="label">Tagline</span>
            <input
              className="input w-full"
              value={appearance?.tagline ?? ''}
              placeholder={DEFAULT_TAGLINE}
              onChange={(e) => commit((a) => ({ ...a, tagline: e.target.value || undefined }))}
            />
          </label>
        </div>

        {/* App logo */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-sm font-extrabold text-slate-800">App logo</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {appearance?.logo ? (
              <img
                src={appearance.logo}
                alt="custom app logo"
                className="h-16 w-16 object-contain"
              />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-3xl ring-1 ring-slate-200">
                🧭
              </span>
            )}
            <div className="flex flex-col gap-2">
              <ImageButton
                label="⬆️ Upload app logo (PNG / JPEG)"
                onFile={async (f) => {
                  try {
                    const dataUrl = await readImageFile(f);
                    commit((a) => ({ ...a, logo: dataUrl }));
                    flash('App logo updated.');
                  } catch (e) {
                    flash(e instanceof Error ? e.message : 'Could not read that image.');
                  }
                }}
              />
              {appearance?.logo && (
                <button
                  onClick={() => {
                    commit((a) => ({ ...a, logo: undefined }));
                    flash('Custom app logo removed — bundled logo restored.');
                  }}
                  className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
                >
                  ✕ Remove custom logo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* App icon mark */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-sm font-extrabold text-slate-800">App icon</p>
          <div className="mt-2">
            <SlotEditor
              title="App icon"
              value={appearance?.appIcon}
              fallbackEmoji="🧭"
              onChange={(v) => commit((a) => ({ ...a, appIcon: v }))}
            />
          </div>
        </div>
      </section>

      {/* ── Tools + Splash/game grouped slots ────────────────────────── */}
      {ICON_GROUPS.filter((g) => g.id !== 'identity').map((group) => (
        <GroupSection
          key={group.id}
          group={group.id}
          label={group.label}
          appearance={appearance}
          onCommit={(v, slotId) =>
            commit((a) => {
              const icons = { ...(a.icons ?? {}) };
              if (v) icons[slotId] = v;
              else delete icons[slotId];
              return { ...a, icons };
            })
          }
        />
      ))}
    </div>
  );
}

function GroupSection({
  group,
  label,
  appearance,
  onCommit,
}: {
  group: IconGroup;
  label: string;
  appearance?: AppAppearance;
  onCommit: (v: AppIcon | undefined, slotId: string) => void;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <SectionTitle title={label} />
      <div className="mt-4 space-y-2.5">
        {slotsByGroup(group).map((slot) => (
          <SlotEditor
            key={slot.id}
            title={`${slot.emoji} ${slot.label}`}
            hint={slot.hint}
            value={appearance?.icons?.[slot.id]}
            fallbackEmoji={slot.emoji}
            onChange={(v) => onCommit(v, slot.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SlotEditor({
  title,
  hint,
  value,
  fallbackEmoji,
  onChange,
}: {
  title: string;
  hint?: string;
  value: AppIcon | undefined;
  fallbackEmoji: string;
  onChange: (v: AppIcon | undefined) => void;
}) {
  const [emojiInput, setEmojiInput] = useState(value?.emoji ?? '');
  const img = value?.image;
  const previewPx = value?.size ?? 48;

  function applyEmoji(emoji: string) {
    setEmojiInput(emoji);
    const trimmed = emoji.trim();
    if (trimmed) onChange({ image: img, emoji: trimmed, size: value?.size });
    else if (img) onChange({ image: img, emoji: fallbackEmoji, size: value?.size });
    else onChange(undefined);
  }

  function setSize(px: number) {
    if (img) onChange({ image: img, emoji: emojiInput.trim() || fallbackEmoji, size: px });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 last:border-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0">{renderPreview(value, fallbackEmoji)}</span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-slate-800">{title}</p>
          {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {img ? 'custom image set' : value?.emoji ? `emoji ${value.emoji}` : 'using default'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={emojiInput}
          maxLength={12}
          onChange={(e) => applyEmoji(e.target.value)}
          placeholder="emoji, e.g. ⭐"
          className="input w-32"
        />
        {img && (
          <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
            Size
            <input
              type="range"
              min={16}
              max={160}
              step={2}
              value={previewPx}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 accent-brand-600"
            />
            <span className="w-9 text-right tabular-nums">{previewPx}px</span>
          </label>
        )}
        <ImageButton
          small
          label="⬆️ Image"
          onFile={async (f) => {
            try {
              onChange({ image: await readImageFile(f), emoji: emojiInput.trim() || fallbackEmoji });
            } catch (e) {
              alert(e instanceof Error ? e.message : 'Could not read that image.');
            }
          }}
        />
        {(value?.emoji || value?.image) && (
          <button
            onClick={() => {
              setEmojiInput('');
              onChange(undefined);
            }}
            className="rounded-lg bg-slate-100 px-2.5 py-2 text-xs font-bold text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// Fixed 96px preview slot: the image scales from the slot's centre
// (spilling past it at large sizes) while the row itself never reflows —
// the same "image overflows, container never grows" rule the app uses.
function renderPreview(value: AppIcon | undefined, fallbackEmoji: string) {
  const el = iconElement(value, fallbackEmoji);
  if (el.type === 'img') {
    const px = el.sizePx ?? 48;
    return (
      <span className="relative flex h-24 w-24 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200"
        />
        <img
          src={el.src}
          alt=""
          className="relative max-w-none shrink-0 object-contain"
          style={{ width: px, height: px }}
        />
      </span>
    );
  }
  return (
    <span className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-0 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200"
      />
      <span className="relative text-2xl leading-none">{el.text}</span>
    </span>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-sm font-black text-slate-800">{title}</h2>
      {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{sub}</p>}
    </div>
  );
}

function ImageButton({
  label,
  small,
  onFile,
}: {
  label: string;
  small?: boolean;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        className={
          small
            ? 'rounded-lg bg-brand-50 px-2.5 py-2 text-xs font-bold text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100'
            : 'btn-ghost'
        }
      >
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
