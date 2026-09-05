import { useRef, useState, type ReactNode } from 'react';
import { useAdmin } from '../adminStore';
import { setAppearance } from '../adminConfigService';
import type { AppAppearance, AppIcon, TextBrandStyle } from '../../config/types';
import {
  BRAND_FONTS,
  DEFAULT_APP_NAME,
  DEFAULT_TAGLINE,
  ICON_GROUPS,
  iconElement,
  slotsByGroup,
  type IconGroup,
} from '../../config/branding';
import { Wordmark, Tagline } from '../../components/Wordmark';
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
        <SectionTitle
          title="App identity"
          sub="Shown on the student app's opening (select institution) screen, the app header, the PWA icon and this console. Text can be replaced by an image, and styled (size / colour / type)."
        />

        {/* Wordmark */}
        <BrandTextControls
          className="mt-3"
          title="App name (wordmark)"
          hint="Replaces “CGPA Pilot” on the opening screen and app header."
          text={name === DEFAULT_APP_NAME && !appearance?.appName ? '' : name}
          placeholder={DEFAULT_APP_NAME}
          onText={(v) => commit((a) => ({ ...a, appName: v || undefined }))}
          image={appearance?.appImage}
          onImage={(v) => {
            commit((a) => ({ ...a, appImage: v }));
            flash(v ? 'Wordmark image set.' : 'Wordmark image removed — text restored.');
          }}
          style={appearance?.appNameStyle}
          onStyle={(patch) => commit((a) => ({ ...a, appNameStyle: { ...(a.appNameStyle ?? {}), ...patch } }))}
          sizeMin={12}
          sizeMax={56}
          sizeDefault={36}
          colorDefault="#ffffff"
          preview={
            <Wordmark
              appearance={{ ...appearance, appName: appearance?.appName || undefined, appImage: appearance?.appImage, appNameStyle: appearance?.appNameStyle }}
              size={20}
              accent
              className="font-black"
            />
          }
        />

        {/* Tagline */}
        <BrandTextControls
          className="mt-3"
          title="Tagline"
          hint="Small line under the wordmark on the opening screen."
          text={appearance?.tagline ?? ''}
          placeholder={DEFAULT_TAGLINE}
          onText={(v) => commit((a) => ({ ...a, tagline: v || undefined }))}
          image={appearance?.taglineImage}
          onImage={(v) => {
            commit((a) => ({ ...a, taglineImage: v }));
            flash(v ? 'Tagline image set.' : 'Tagline image removed — text restored.');
          }}
          style={appearance?.taglineStyle}
          onStyle={(patch) => commit((a) => ({ ...a, taglineStyle: { ...(a.taglineStyle ?? {}), ...patch } }))}
          sizeMin={10}
          sizeMax={32}
          sizeDefault={16}
          colorDefault="#ffffff"
          preview={
            <Tagline
              appearance={{ ...appearance, tagline: appearance?.tagline || undefined, taglineImage: appearance?.taglineImage, taglineStyle: appearance?.taglineStyle }}
              size={12}
            />
          }
        />

        {/* App logo */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-sm font-extrabold text-slate-800">App logo</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The mark on the opening screen (and the PWA/tab icon). Its size scales in place — the layout never moves.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {/* Fixed 128px preview slot: the logo grows in place like in the app. */}
            <span className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200">
              {appearance?.logo ? (
                <img
                  src={appearance.logo}
                  alt="custom app logo"
                  className="relative max-w-none object-contain"
                  style={{ width: appearance.logoSize ?? 80, height: appearance.logoSize ?? 80 }}
                />
              ) : (
                <span className="text-3xl">🧭</span>
              )}
            </span>
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
              <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                Size
                <input
                  type="range"
                  min={32}
                  max={160}
                  step={4}
                  value={appearance?.logoSize ?? 80}
                  onChange={(e) => commit((a) => ({ ...a, logoSize: Number(e.target.value) }))}
                  className="w-28 accent-brand-600"
                />
                <span className="w-9 text-right tabular-nums">{appearance?.logoSize ?? 80}px</span>
                {(appearance?.logoSize ?? 80) !== 80 && (
                  <button
                    onClick={() => commit((a) => ({ ...a, logoSize: undefined }))}
                    title="Reset to default (80px)"
                    className="rounded px-1 text-slate-400 hover:text-slate-700"
                  >
                    ✕
                  </button>
                )}
              </label>
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

/**
 * One brand text field (wordmark / tagline): editable text OR an image,
 * plus font size / colour / type controls (text only) and a live preview
 * chip that mirrors the dark opening screen.
 */
function BrandTextControls({
  className = '',
  title,
  hint,
  text,
  placeholder,
  onText,
  image,
  onImage,
  style,
  onStyle,
  sizeMin,
  sizeMax,
  sizeDefault,
  colorDefault,
  preview,
}: {
  className?: string;
  title: string;
  hint?: string;
  text: string;
  placeholder: string;
  onText: (v: string) => void;
  image: string | undefined;
  onImage: (v: string | undefined) => void;
  style: TextBrandStyle | undefined;
  onStyle: (patch: Partial<TextBrandStyle>) => void;
  sizeMin: number;
  sizeMax: number;
  sizeDefault: number;
  colorDefault: string;
  preview: ReactNode;
}) {
  const size = style?.fontSize ?? sizeDefault;
  return (
    <div className={`rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-extrabold text-slate-800">
            {title}
            {hint && <span className="ml-1.5 text-[10px] font-semibold text-slate-400">{hint}</span>}
          </p>
          <input
            className="input w-full"
            value={text}
            placeholder={placeholder}
            onChange={(e) => onText(e.target.value)}
            disabled={!!image}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ImageButton
              small
              label={image ? '⬆️ Replace image' : '🖼️ Use an image instead'}
              onFile={async (f) => {
                try {
                  onImage(await readImageFile(f));
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Could not read that image.');
                }
              }}
            />
            {image && (
              <button
                onClick={() => onImage(undefined)}
                className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-600 ring-1 ring-red-200 transition hover:bg-red-100"
              >
                ✕ Remove image
              </button>
            )}
          </div>
        </div>
        {/* Live preview on the dark opening-screen colour */}
        <div className="flex h-12 w-44 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-brand-900 to-brand-700 px-2">
          {preview}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
          Size
          <input
            type="range"
            min={sizeMin}
            max={sizeMax}
            step={1}
            value={size}
            onChange={(e) => onStyle({ fontSize: Number(e.target.value) })}
            className="w-24 accent-brand-600"
          />
          <span className="w-9 text-right tabular-nums">{size}px</span>
          {style?.fontSize !== undefined && (
            <button
              onClick={() => onStyle({ fontSize: undefined })}
              title={`Reset to default (${sizeDefault}px)`}
              className="rounded px-0.5 text-slate-400 hover:text-slate-700"
            >
              ✕
            </button>
          )}
        </label>
        {!image && (
          <>
            <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
              Colour
              <input
                type="color"
                value={style?.color ?? colorDefault}
                onChange={(e) => onStyle({ color: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
              />
              {style?.color && (
                <button
                  onClick={() => onStyle({ color: undefined })}
                  title="Reset to default"
                  className="rounded px-0.5 text-slate-400 hover:text-slate-700"
                >
                  ✕
                </button>
              )}
            </label>
            <label className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
              Font
              <select
                className="input w-auto py-1.5"
                value={style?.fontFamily ?? 'system'}
                onChange={(e) => onStyle({ fontFamily: e.target.value === 'system' ? undefined : e.target.value })}
              >
                {BRAND_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </div>
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
