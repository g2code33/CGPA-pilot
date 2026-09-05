import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { appLogoImage, appName, iconGlyph } from '../config/branding';
import type { AppAppearance } from '../config/types';

/**
 * "Sky Dash" — the app opening doubles as a tiny catchy mini-game.
 *
 * The aeroplane is the star: press & hold anywhere and drag to steer it through
 * the sky collecting ⭐ stars. While you are holding you are "flying", so the
 * take-off countdown is paused; the moment you let go it continues the seconds
 * and, when they run out, loads the institution page.
 */
interface Star {
  id: number;
  x: number;
  y: number;
}
interface Spark {
  id: number;
  x: number;
  y: number;
}

const PLANE = 84; // plane hitbox (px)
const STAR_R = 22; // collect radius (px)
/** Each ⭐ caught is worth this much CGPA in the Sky Dash score. */
const STAR_CGPA = 0.001;

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

let _id = 1;
const nid = () => _id++;

export function SkySplash({
  appearance,
  onDone,
  height,
}: {
  appearance?: AppAppearance;
  onDone: () => void;
  /** Optional fixed height (px). Defaults to filling the viewport. */
  height?: number;
}) {
  const arenaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const [plane, setPlane] = useState({ x: -1, y: -1 });
  const planeRef = useRef({ x: -1, y: -1 });
  const planeReady = useRef(false);
  const [tilt, setTilt] = useState(0);
  const dragRef = useRef(false);
  const [stars, setStars] = useState<Star[]>([]);
  const starsRef = useRef<Star[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [starCount, setStarCount] = useState(0); // stars caught
  const cgpaText = (starCount * STAR_CGPA).toFixed(3); // score shown as CGPA

  // Flight budget (ms). Runs down ONLY when the plane is not being held.
  const TOTAL_BUDGET = 4200;
  const [budget, setBudget] = useState(TOTAL_BUDGET);
  const budgetRef = useRef(TOTAL_BUDGET);
  const doneRef = useRef(false);
  const [landed, setLanded] = useState(false);

  const logo = appLogoImage(appearance);
  const wordmark = appName(appearance);
  const glyph = appearance?.appIcon?.image
    ? undefined
    : iconGlyph(appearance?.appIcon, '🧭');

  // Administrator-settable Sky Dash graphics (from the Icon & Branding manager).
  const planeOverride = appearance?.icons?.['plane'];
  const starOverride = appearance?.icons?.['star'];
  const landingOverride = appearance?.icons?.['landing'];
  const starChar = starOverride?.image ? '⭐' : iconGlyph(starOverride, '⭐');
  const hasStarImg = !!starOverride?.image;
  const landingChar = landingOverride?.image ? '🛬' : iconGlyph(landingOverride, '🛬');
  const hasLandingImg = !!landingOverride?.image;
  const hasPlaneImg = !!planeOverride?.image;
  const planeEmoji = planeOverride && !planeOverride.image ? planeOverride.emoji : '';

  // Measure the arena once it mounts.
  useEffect(() => {
    const el = arenaRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = { w: r.width, h: r.height };
      sizeRef.current = s;
      setSize(s);
      if (!planeReady.current && s.w > 0 && s.h > 0) {
        planeReady.current = true;
        const x = s.w * 0.42;
        const y = s.h * 0.74;
        setPlane({ x, y });
        planeRef.current = { x, y };
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Spawn the first set of stars once we know the arena size.
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const spawn = () => {
      const count = Math.max(6, Math.min(9, Math.round(size.w / 70)));
      const arr: Star[] = [];
      for (let i = 0; i < count; i++) {
        arr.push(makeStar());
      }
      setStars(arr);
    };
    spawn();
  }, [size]);

  const bounds = useCallback(() => {
    const { w, h } = sizeRef.current;
    const hw = PLANE / 2;
    return { minX: hw, maxX: Math.max(hw, w - hw), minY: hw, maxY: Math.max(hw, h - hw) };
  }, []);

  const makeStar = useCallback((): Star => {
    const { minX, maxX, minY, maxY } = bounds();
    return {
      id: nid(),
      x: rand(minX + 8, Math.max(minX + 8, maxX - 8)),
      y: rand(minY + 6, Math.max(minY + 6, maxY - 20)),
    };
  }, [bounds]);

  // Mirror state into refs for the interval handlers.
  useEffect(() => {
    starsRef.current = stars;
  }, [stars]);
  useEffect(() => {
    budgetRef.current = budget;
  }, [budget]);
  useEffect(() => {
    planeRef.current = plane;
  }, [plane]);

  // Core game loop: countdown (paused while dragging) + star collection.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (doneRef.current) return;

      // Collection: fly through a star to grab it.
      const cur = starsRef.current;
      const p = planeRef.current;
      const caught = cur.filter((s) => {
        const dx = s.x - p.x;
        const dy = s.y - p.y;
        return Math.hypot(dx, dy) <= STAR_R;
      });
      if (caught.length > 0) {
        const ids = new Set(caught.map((s) => s.id));
        setStarCount((sc) => sc + caught.length);
        setSparks((sp) => [
          ...sp,
          ...caught.map((s) => ({ id: nid(), x: s.x, y: s.y })),
        ]);
        setStars((arr) => {
          const keep = arr.filter((s) => !ids.has(s.id));
          // Top up so the sky never feels empty.
          const need = Math.max(0, 6 - keep.length);
          const add: Star[] = [];
          for (let i = 0; i < need; i++) add.push(makeStar());
          return [...keep, ...add];
        });
      }
      // Fade out sparkles.
      setSparks((sp) => (sp.length ? sp.slice(-14) : sp));

      // Countdown: only runs when the plane is not being held.
      if (!dragRef.current) {
        const next = budgetRef.current - 100;
        if (next <= 0) {
          if (!doneRef.current) {
            doneRef.current = true;
            setBudget(0);
            setLanded(true);
          }
        } else {
          setBudget(next);
        }
      }
    }, 100);
    return () => window.clearInterval(iv);
  }, [makeStar]);

  // After landing, give a beat for the player to see then continue.
  useEffect(() => {
    if (!landed) return;
    const t = window.setTimeout(onDone, 900);
    return () => window.clearTimeout(t);
  }, [landed, onDone]);

  // Skip the session (two skip buttons: HUD top-right + above the countdown).
  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setBudget(0);
    setLanded(true);
  };

  function moveTo(clientX: number, clientY: number) {
    const el = arenaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { minX, maxX, minY, maxY } = bounds();
    const x = Math.max(minX, Math.min(maxX, clientX - r.left));
    const y = Math.max(minY, Math.min(maxY, clientY - r.top));
    setPlane({ x, y });
    planeRef.current = { x, y };
  }

  const lastDragX = useRef(0);
  function onDown(e: RPointerEvent<HTMLDivElement>) {
    if (doneRef.current) return;
    dragRef.current = true;
    lastDragX.current = e.clientX;
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    moveTo(e.clientX, e.clientY);
    setTilt(0);
  }
  function onMove(e: RPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    moveTo(e.clientX, e.clientY);
    // Bank into the turn: tilt by how fast you sweep sideways.
    const dx = e.clientX - lastDragX.current;
    lastDragX.current = e.clientX;
    const lean = Math.max(-28, Math.min(28, dx * 1.6));
    setTilt(lean);
  }
  function onUp() {
    dragRef.current = false;
    lastDragX.current = 0;
    setTilt(0);
  }

  const planePos = planeReady.current ? plane : { x: 0, y: 0 };
  const pct = Math.max(0, Math.min(1, budget / TOTAL_BUDGET));
  const onScreen = size.w > 0 && size.h > 0;

  return (
    <div
      ref={arenaRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="relative z-50 w-full touch-none select-none overflow-hidden bg-gradient-to-br from-indigo-900 via-brand-800 to-emerald-800 text-white"
      style={{ touchAction: 'none', ...(height ? { height } : { height: '100dvh' }) }}
    >
      {/* drifting clouds */}
      <span className="sky-cloud sky-cloud-a" />
      <span className="sky-cloud sky-cloud-b" />
      <span className="sky-cloud sky-cloud-c" />
      <span className="sky-sun" aria-hidden="true" />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          {logo ? (
            <img src={logo} alt="app logo" className="h-9 w-9 object-contain drop-shadow" />
          ) : glyph ? (
            <span className="text-3xl leading-none drop-shadow">{glyph}</span>
          ) : (
            <span className="text-sm font-black uppercase drop-shadow">CP</span>
          )}
          <div>
            <p className="text-sm font-black uppercase tracking-wide drop-shadow">
              {wordmark.split(' ')[0] ?? 'CGPA'}
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/70">
              Sky Dash
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-2xl bg-black/20 px-3 py-1.5 text-center backdrop-blur">
            <p className="text-base font-black leading-none tabular-nums text-amber-300">
              {cgpaText}
            </p>
            <p className="text-[8px] font-bold uppercase tracking-wide text-white/70">CGPA</p>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={skip}
            className="pointer-events-auto rounded-2xl bg-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-wide ring-1 ring-white/30 backdrop-blur transition hover:bg-white/25 active:scale-95"
          >
            ⏭ Skip
          </button>
        </div>
      </div>

      {/* title block */}
      <div className="pointer-events-none absolute inset-x-0 top-16 z-10 px-6 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-200/90 drop-shadow">
          Catch stars · each ⭐ = 0.001 CGPA
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight drop-shadow-lg sm:text-4xl">
          {wordmark}
        </h1>
      </div>

      {/* take-off countdown bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 px-5">
        {/* second skip button, right above the countdown */}
        <div className="mx-auto mb-2 flex max-w-xs justify-center">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={skip}
            className="pointer-events-auto rounded-full bg-white/20 px-6 py-2.5 text-xs font-black uppercase tracking-wide ring-1 ring-white/40 backdrop-blur transition hover:bg-white/30 active:scale-95"
          >
            ⏭ Skip
          </button>
        </div>
        <div className="mx-auto flex max-w-xs items-center gap-3">
          <span className="text-xl drop-shadow">🛫</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/25 ring-1 ring-white/20">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${dragRef.current ? 'bg-emerald-300' : 'bg-amber-300'}`}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <span className="text-sm font-black tabular-nums drop-shadow">{(budget / 1000).toFixed(1)}s</span>
        </div>
        <p className="mt-1.5 text-center text-[10px] font-semibold text-white/75">
          {dragRef.current
            ? '✈️ Flying… release to continue the countdown'
            : '✈️ Press & hold to fly — grab ⭐ stars and stack up CGPA!'}
        </p>
      </div>

      {/* stars */}
      {onScreen &&
        stars.map((s) => (
          <span
            key={s.id}
            className="sky-star"
            style={{ left: s.x, top: s.y, transform: 'translate(-50%, -50%)' }}
          >
            {hasStarImg ? (
              <img
                src={starOverride?.image}
                alt=""
                style={starOverride?.size ? { width: starOverride.size, height: starOverride.size } : undefined}
                className="pointer-events-none h-[30px] w-[30px] object-contain"
              />
            ) : (
              <span style={{ fontSize: 30, lineHeight: 1 }}>{starChar}</span>
            )}
          </span>
        ))}

      {/* sparks */}
      {sparks.map((s) => (
        <span
          key={s.id}
          className="sky-spark"
          style={{ left: s.x, top: s.y }}
        >
          +{STAR_CGPA} CGPA
        </span>
      ))}

      {/* the aeroplane */}
      <div
        className="pointer-events-none absolute z-10 transition-transform duration-75"
        style={{
          left: planePos.x,
          top: planePos.y,
          transform: `translate(-50%, -50%) rotate(${tilt}deg) ${dragRef.current ? 'scale(1.12)' : 'scale(1)'}`,
        }}
      >
        <div
          className={`grid h-[84px] w-[84px] place-items-center rounded-full ${dragRef.current ? 'bg-white/15' : ''}`}
        >
          {hasPlaneImg ? (
            <img
              src={planeOverride?.image}
              alt="plane"
              style={planeOverride?.size ? { width: planeOverride.size, height: planeOverride.size } : undefined}
              className="pointer-events-none h-16 w-16 object-contain drop-shadow-[0_10px_14px_rgba(0,0,0,0.35)]"
            />
          ) : planeEmoji ? (
            <span className="text-5xl drop-shadow-[0_10px_14px_rgba(0,0,0,0.35)]" style={{ lineHeight: 1 }}>
              {planeEmoji}
            </span>
          ) : (
            <svg viewBox="0 0 64 64" className="h-14 w-14 drop-shadow-[0_10px_14px_rgba(0,0,0,0.35)]">
              <path
                d="M6 40 L32 10 a3 3 0 0 1 5 2 L35 28 58 33 c3 1 3 5 0 6 l-24 -6 -10 10 3 6 -8 -5 -9 -1 c-3 0 -5 -1 -4 -3 Z"
                fill="#f8fafc"
                stroke="#1e293b"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="44" cy="18" r="4.2" fill="#f59e0b" />
            </svg>
          )}
        </div>
      </div>

      {/* landing overlay */}
      {landed && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-brand-900/40 backdrop-blur-sm">
          <div className="text-center">
            {hasLandingImg ? (
              <img src={landingOverride?.image} alt="" className="mx-auto h-16 w-16 object-contain drop-shadow" />
            ) : (
              <p className="text-6xl" style={{ lineHeight: 1 }}>{landingChar}</p>
            )}
            <h2 className="mt-2 text-2xl font-black drop-shadow">You’re here!</h2>
            <p className="mt-1 text-sm text-white/80">
              {starCount > 0
                ? `Nice flying — you earned ${cgpaText} CGPA ⭐`
                : 'Wheels down — let’s set you up.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
