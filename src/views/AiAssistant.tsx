import { useCallback, useEffect, useRef, useState } from 'react';
import { useAcademic } from '../state/store';
import { useDerived } from '../state/derived';
import { resolveContext } from '../config/context';
import { getAiStatusShared, sendAiMessage } from '../services/aiChat';
import { buildAiContext, hasAnyStudentData } from '../services/aiContext';
import type { AiChatMessage, AiPublicStatus } from '../admin/aiSettings';
import { permissionOn } from '../permissions';
import { fmt2 } from '../util/format';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * CGPA PILOT AI — the assistant that already knows the student's position.
 *
 *   • Answers questions using the LIVE data from the student's tools
 *     (results, semesters, target, planned credits) — sent only per question.
 *   • Students with EMPTY tools are guided: quick tabs take them straight to
 *     the tool they should fill so the AI can use their real numbers.
 *   • States handled: offline, feature off, being set up (no keys), rate
 *     limited, provider errors — each with an honest, actionable message.
 *
 * Conversation is IN-MEMORY ONLY (same privacy contract as the tools).
 */
export function AiAssistant({ onNavigate, aiStatus }: { onNavigate: (screen: string) => void; aiStatus?: AiPublicStatus | null }) {
  const { state } = useAcademic();
  const d = useDerived();
  const [status, setStatus] = useState<AiPublicStatus | null>(aiStatus ?? null);
  const [statusChecked, setStatusChecked] = useState(aiStatus !== undefined);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const whatIfAllowed = permissionOn('allowWhatIf');

  const hasData = hasAnyStudentData(state);
  const heroCgpa =
    d.record.cgpa !== null
      ? d.record.cgpa
      : state.mode === 'history'
        ? (state.semesters.find((s) => s.gpa !== null)?.gpa ?? null)
        : state.baseline.cgpa;

  // Load the public AI status (best-effort; the section explains the rest).
  const loadStatus = useCallback(async () => {
    const s = await getAiStatusShared();
    setStatus(s);
    setStatusChecked(true);
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  function contextChip(): string | null {
    if (!hasData) return null;
    const bits: string[] = [];
    if (heroCgpa !== null) bits.push(`CGPA ${fmt2(heroCgpa)}`);
    if (state.mode === 'history') bits.push(`${state.semesters.filter((s) => s.gpa !== null).length} semesters`);
    if (state.targetCgpa !== null) bits.push(`target ${fmt2(state.targetCgpa)}`);
    if (d.record.pendingCreditHours > 0) bits.push(`${d.record.pendingCreditHours} pending cr`);
    return bits.join(' · ');
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || thinking || !status) return;
    setError(null);
    const next: ChatMsg[] = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setThinking(true);
    const ctx = buildAiContext(
      state,
      {
        creditHours: d.record.creditHours,
        points: d.record.points,
        cgpa: d.record.cgpa,
        pendingCreditHours: d.record.pendingCreditHours,
      },
      d.classBand?.label ?? null,
      (() => {
        const c = resolveContext();
        return { university: c.university?.shortName || c.university?.name, school: c.school?.name, programme: c.programme?.name };
      })()
    );
    const res = await sendAiMessage({ status, messages: next, context: ctx });
    setThinking(false);
    if (res.ok) {
      setMessages((m) => [...m, { role: 'assistant', content: res.text || '…' }]);
    } else {
      setError(res.message);
    }
  }

  // ── Status gates (honest, actionable states) ────────────────────────────
  if (!statusChecked) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-3xl ring-1 ring-brand-100">🤖</span>
        <p className="text-sm font-semibold text-slate-600">Checking the AI assistant…</p>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <span className="text-4xl">📡</span>
        <h3 className="text-base font-black text-slate-800">AI unavailable right now</h3>
        <p className="max-w-xs text-xs leading-relaxed text-slate-500">
          The AI service could not be reached (you may be offline, or the administrator has not enabled it on this deployment).
        </p>
        <button onClick={() => void loadStatus()} className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.98]">
          ↻ Try again
        </button>
      </div>
    );
  }

  if (!status.enabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <span className="text-4xl">🔕</span>
        <h3 className="text-base font-black text-slate-800">AI is currently switched off</h3>
        <p className="max-w-xs text-xs leading-relaxed text-slate-500">
          Your administrator can turn the AI assistant on from the admin console (AI Settings). Meanwhile, all your tools work as usual.
        </p>
      </div>
    );
  }

  if (!status.ready) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        <span className="text-4xl">🛠️</span>
        <h3 className="text-base font-black text-slate-800">{status.label} is being set up</h3>
        <p className="max-w-xs text-xs leading-relaxed text-slate-500">
          Your administrator has not finished connecting an AI provider yet. Check back soon — everything else in the app works normally.
        </p>
      </div>
    );
  }

  const chip = contextChip();

  return (
    <div className="flex h-full flex-col">
      {/* Status + context header */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-black text-brand-700 ring-1 ring-brand-100">
          🤖 {status.label}
        </span>
        {chip ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200" title="What the AI can currently see from your tools">
            📊 {chip}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
            ⚠️ No tool data yet
          </span>
        )}
        {messages.length > 0 && (
          <button
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            className="ml-auto rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            🧹 New chat
          </button>
        )}
      </div>

      {/* Empty-tools guidance: quick tabs to the tools that unlock full AI */}
      {!hasData && (
        <div className="mb-2 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-3">
          <p className="text-xs font-black text-brand-900">🚀 Unlock the full AI with your real numbers</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            The AI can already answer general questions — but it answers <strong>perfectly</strong> when it can see your results, target and plan. Tap a tool below to fill it in:
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <QuickTab icon="📝" label="My results" hint="Level + CGPA / grades" onClick={() => onNavigate('calculate')} />
            <QuickTab icon="🎯" label="Target" hint="Your goal classification" onClick={() => onNavigate('target')} />
            <QuickTab icon="▶️" label="Next Semester" hint="Credits coming up" onClick={() => onNavigate('next')} />
            {whatIfAllowed && <QuickTab icon="🔀" label="What-If" hint="Try future GPAs" onClick={() => onNavigate('whatif')} />}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-2xl bg-red-50 p-3 ring-1 ring-red-100">
          <span className="text-base leading-none">⚠️</span>
          <p className="flex-1 text-[11px] font-semibold leading-relaxed text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-xs font-black text-red-400 hover:text-red-600" aria-label="Dismiss error">
            ✕
          </button>
        </div>
      )}

      {/* Conversation */}
      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto rounded-2xl bg-white p-3 ring-1 ring-slate-200" style={{ minHeight: 200 }}>
        {messages.length === 0 && !thinking && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="text-3xl">💬</span>
            <p className="text-sm font-black text-slate-700">Ask anything about your academics</p>
            <p className="max-w-[260px] text-[11px] leading-relaxed text-slate-500">
              {hasData
                ? '“How do I get to first class?” · “What if I get 3.50 next semester?” · “Which semester dragged my CGPA down?”'
                : '“How is CGPA calculated?” · “What GPA do I need for a second class upper?” — or fill a tool above for answers with your real numbers.'}
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-md bg-brand-600 text-white shadow-sm'
                  : 'rounded-bl-md bg-slate-100 text-slate-800 ring-1 ring-slate-200/60'
              }`}
            >
              {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 ring-1 ring-slate-200/60">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:240ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="Ask about your CGPA, target, next semester…"
          className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border-0 bg-white px-4 py-3 text-[13px] font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          onClick={() => void send(input)}
          disabled={thinking || !input.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-lg text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:opacity-40"
          aria-label="Send"
        >
          ➤
        </button>
      </div>

      {/* Privacy notice */}
      <p className="mt-2 px-1 text-center text-[10px] leading-snug text-slate-400">
        🔒 {status.notice || 'Your tool data is sent to the AI provider only when you ask a question — it is never stored by the app.'}
      </p>
    </div>
  );
}

function QuickTab({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl bg-white p-2 text-left ring-1 ring-brand-200 transition hover:bg-brand-50 active:scale-[0.98]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-base">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-black text-slate-800">{label}</span>
        <span className="block truncate text-[9px] font-semibold text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

// ── Minimal Markdown renderer (bold, italic, code, lists, links, newlines) ─

function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: number) => {
    if (!listBuf) return;
    const items = listBuf.items;
    const ordered = listBuf.ordered;
    out.push(
      ordered ? (
        <ol key={`l${key}`} className="ml-4 list-decimal space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l${key}`} className="ml-4 list-disc space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${i}`)}</li>
          ))}
        </ul>
      )
    );
    listBuf = null;
  };

  blocks.forEach((raw, i) => {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = !!ol;
      if (!listBuf || listBuf.ordered !== ordered) {
        flushList(i);
        listBuf = { ordered, items: [] };
      }
      listBuf.items.push((ul ?? ol)![1]);
      return;
    }
    flushList(i);
    if (!line.trim()) return;
    out.push(<p key={i}>{renderInline(line, `p${i}`)}</p>);
  });
  flushList(blocks.length);

  return <div className="space-y-1.5">{out}</div>;
}

function renderInline(text: string, key: string): React.ReactNode {
  // Split on inline tokens: `code`, **bold**, *italic*, [label](url)
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(
        <code key={`${key}-${k++}`} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('**')) {
      parts.push(
        <strong key={`${key}-${k++}`}>{tok.slice(2, -2)}</strong>
      );
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mm) {
        parts.push(
          <a key={`${key}-${k++}`} href={mm[2]} target="_blank" rel="noreferrer" className="underline decoration-brand-300 underline-offset-2">
            {mm[1]}
          </a>
        );
      } else {
        parts.push(tok);
      }
    } else {
      parts.push(
        <em key={`${key}-${k++}`}>{tok.slice(1, -1)}</em>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
