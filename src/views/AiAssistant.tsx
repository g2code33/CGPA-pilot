import { useCallback, useEffect, useRef, useState } from 'react';
import { useAcademic } from '../state/store';
import { useDerived } from '../state/derived';
import { resolveContext } from '../config/context';
import { getAiStatusShared, streamAiMessage } from '../services/aiChat';
import { buildAiContext, hasAnyStudentData } from '../services/aiContext';
import {
  loadAiHistory,
  appendMessage,
  startNewConversation,
  openConversation,
  deleteConversation,
  type AiConv,
  type AiHistory,
} from '../services/aiHistory';
import type { AiChatMessage, AiPublicStatus } from '../admin/aiSettings';
import { permissionOn } from '../permissions';
import { fmt2 } from '../util/format';

interface ErrorState {
  message: string;
  /** The question to re-ask on Retry. */
  retry: { text: string; images: string[] } | null;
}

/**
 * CGPA PILOT AI — the assistant that already knows the student's position.
 *
 *   • Answers with the LIVE data from the student's tools (sent per question).
 *   • STREAMING: words appear as they are generated (feels fast).
 *   • Conversations are kept on THIS device: the hamburger (🕘) lists every
 *     past chat — start a new one and the old stays available to revisit.
 *     Only the app's 🔄 Clear button wipes them.
 *   • 📎 attach an image · 📤 share · ⬇ download · ‹ collapse back to the
 *     screen the student was on.
 *   • Full-height layout: header + notices stay put, ONLY the conversation
 *     scrolls, the typing area is fixed at the bottom.
 *   • Students never see provider errors — a calm message + Retry instead.
 */
export function AiAssistant({
  onNavigate,
  onCollapse,
  aiStatus,
}: {
  onNavigate: (screen: string) => void;
  onCollapse: () => void;
  aiStatus?: AiPublicStatus | null;
}) {
  const { state } = useAcademic();
  const d = useDerived();
  const [status, setStatus] = useState<AiPublicStatus | null>(aiStatus ?? null);
  const [statusChecked, setStatusChecked] = useState(aiStatus !== undefined);
  const [history, setHistory] = useState<AiHistory>(() => loadAiHistory());
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [meta, setMeta] = useState<{ provider: string; model: string } | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const whatIfAllowed = permissionOn('allowWhatIf');

  const activeConv = history.convs.find((c) => c.id === history.activeId) ?? null;
  const messages = activeConv?.messages ?? [];
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

  // Keep the newest answer in view (also while tokens stream in).
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, liveText, thinking, error]);

  function contextChip(): string | null {
    if (!hasData) return null;
    const bits: string[] = [];
    if (heroCgpa !== null) bits.push(`CGPA ${fmt2(heroCgpa)}`);
    if (state.mode === 'history') bits.push(`${state.semesters.filter((s) => s.gpa !== null).length} semesters`);
    if (state.targetCgpa !== null) bits.push(`target ${fmt2(state.targetCgpa)}`);
    if (d.record.pendingCreditHours > 0) bits.push(`${d.record.pendingCreditHours} pending cr`);
    return bits.join(' · ');
  }

  async function send(rawText: string, images: string[]) {
    const q = rawText.trim();
    if ((!q && !images.length) || thinking || !status) return;
    setError(null);

    // Context window: the last few turns of THIS conversation + the question.
    const past: AiChatMessage[] = messages.slice(-10).map((m) => {
      const content: AiChatMessage['content'] = m.images?.length
        ? [...m.images.map((i) => ({ type: 'image' as const, dataUrl: i })), { type: 'text' as const, text: m.text }]
        : m.text;
      return { role: m.role, content };
    });
    const userContent: AiChatMessage['content'] = q
      ? images.length
        ? [{ type: 'text', text: q }, ...images.map((i) => ({ type: 'image' as const, dataUrl: i }))]
        : q
      : images.map((i) => ({ type: 'image' as const, dataUrl: i }));
    const next: AiChatMessage[] = [...past, { role: 'user', content: userContent }];

    // The student's words are kept on-device immediately (history survives).
    setHistory((h) => appendMessage(h, { role: 'user', text: q || '📷 image', images: images.length ? images : undefined }));
    setInput('');
    setAttachments([]);
    setThinking(true);
    setLiveText('');
    setMeta(null);

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

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const res = await streamAiMessage({ status, messages: next, context: ctx }, {
      signal: ctrl.signal,
      onDelta: (chunk) => setLiveText((t) => t + chunk),
      onMeta: (m) => setMeta(m),
    });
    abortRef.current = null;
    setThinking(false);

    if (res.ok) {
      setHistory((h) => appendMessage(h, { role: 'assistant', text: res.text || '…' }));
      setLiveText('');
    } else if (res.code === 'interrupted') {
      setLiveText('');
    } else {
      setLiveText('');
      setError({ message: res.message, retry: { text: q, images } });
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

  // ── Share / download the current conversation ───────────────────────────
  function chatToText(conv: AiConv): string {
    const head = `${status?.label ?? 'CGPA Pilot AI'} — ${new Date(conv.updatedAt).toLocaleString()}\n${'='.repeat(40)}\n\n`;
    const body = conv.messages
      .map((m) => {
        const who = m.role === 'user' ? 'You' : status?.label ?? 'AI';
        return `${who} (${new Date(m.ts).toLocaleTimeString()}):${m.images?.length ? `\n📷 ${m.images.length} image(s) attached` : ''}\n${m.text}`;
      })
      .join('\n\n');
    return head + body;
  }

  async function shareChat() {
    if (!activeConv || !activeConv.messages.length) return;
    const text = chatToText(activeConv);
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'CGPA Pilot AI conversation', text });
        return;
      } catch {
        /* user cancelled the share sheet — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function downloadChat() {
    if (!activeConv || !activeConv.messages.length) return;
    const md = [
      `# ${status?.label ?? 'CGPA Pilot AI'} — conversation`,
      ``,
      `_Exported ${new Date().toLocaleString()}_`,
      ``,
      ...activeConv.messages.map((m) => {
        const who = m.role === 'user' ? '**You**' : `**${status?.label ?? 'AI'}**`;
        return `${who} · ${new Date(m.ts).toLocaleTimeString()}\n\n${m.text}${m.images?.length ? `\n\n_${m.images.length} image(s) attached (not exported)_` : ''}`;
      }),
    ].join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cgpa-pilot-ai-${new Date(activeConv.updatedAt).toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Image attachment (compressed to keep history small) ─────────────────
  function onPickImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, 2 - attachments.length));
    for (const file of files) {
      downscaleImage(file)
        .then((url) => setAttachments((a) => (a.length < 2 ? [...a, url] : a)))
        .catch(() => undefined);
    }
    e.target.value = '';
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Sticky AI header (never scrolls) ─────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-black text-brand-700 ring-1 ring-brand-100">
          🤖 {status.label}
        </span>
        {chip && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"
            title="What the AI can currently see from your tools"
          >
            📊 {chip}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <HeaderBtn title="Chat history (all your conversations)" onClick={() => setHistoryOpen(true)}>
            🕘
          </HeaderBtn>
          <HeaderBtn title="Share this chat" onClick={() => void shareChat()} disabled={!messages.length}>
            {copied ? '✅' : '📤'}
          </HeaderBtn>
          <HeaderBtn title="Download this chat (.md)" onClick={downloadChat} disabled={!messages.length}>
            ⬇️
          </HeaderBtn>
          <button
            onClick={onCollapse}
            title="Collapse — back to where you were"
            className="rounded-full bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 active:scale-95"
          >
            ‹ Collapse
          </button>
        </div>
      </div>

      {/* ── Static notices (never scroll) ───────────────────────────────── */}
      {!hasData && (
        <div className="mt-2 shrink-0 rounded-2xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-black text-red-700">⚠️ You haven't entered your details yet</p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-red-600">
            Until the AI can see your real numbers, answers will only be <strong>general</strong>. Enter your details in a tool below to unlock personal answers:
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <QuickTab icon="📝" label="My results" hint="Level + CGPA / grades" onClick={() => onNavigate('calculate')} />
            <QuickTab icon="🎯" label="Target" hint="Your goal classification" onClick={() => onNavigate('target')} />
            <QuickTab icon="▶️" label="Next Semester" hint="Credits coming up" onClick={() => onNavigate('next')} />
            {whatIfAllowed && <QuickTab icon="🔀" label="What-If" hint="Try future GPAs" onClick={() => onNavigate('whatif')} />}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 flex shrink-0 items-start gap-2 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <span className="text-base leading-none">⚠️</span>
          <p className="flex-1 text-[11px] font-semibold leading-relaxed text-amber-800">
            {error.message}
            {error.retry && (
              <button
                onClick={() => void send(error.retry!.text, error.retry!.images)}
                className="ml-2 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-amber-700"
              >
                ↻ Retry
              </button>
            )}
          </p>
          <button onClick={() => setError(null)} className="text-xs font-black text-amber-400 hover:text-amber-600" aria-label="Dismiss warning">
            ✕
          </button>
        </div>
      )}

      {/* ── Conversation — the ONLY part that scrolls ───────────────────── */}
      <div ref={listRef} className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <div className="space-y-2.5">
          {messages.length === 0 && !thinking && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <span className="text-3xl">💬</span>
              <p className="text-sm font-black text-slate-700">Ask anything about your academics</p>
              <p className="max-w-[280px] text-[11px] leading-relaxed text-slate-500">
                {hasData
                  ? '“How do I get to first class?” · “Show me my semester-by-semester GPAs” · “Which courses dragged my CGPA down?”'
                  : '“How is CGPA calculated?” · “What GPA do I need for a second class upper?”'}
              </p>
              <p className="mt-1 text-[10px] font-semibold text-slate-400">
                🕘 Your chats are kept on this device — open history to revisit them.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <MsgBubble key={m.id} role={m.role} text={m.text} images={m.images} />
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 ring-1 ring-slate-200/60">
                {liveText ? (
                  <Markdown text={liveText} />
                ) : (
                  <span className="flex items-center gap-1.5 py-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:240ms]" />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Fixed typing area (never scrolls) ───────────────────────────── */}
      <div className="mt-2 shrink-0">
        {attachments.length > 0 && (
          <div className="mb-1.5 flex gap-1.5">
            {attachments.map((src, i) => (
              <span key={i} className="relative inline-block">
                <img src={src} alt={`attachment ${i + 1}`} className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200" />
                <button
                  onClick={() => setAttachments((a) => a.filter((_, k) => k !== i))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-[9px] font-black text-white"
                  aria-label="Remove image"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPickImages} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={thinking || attachments.length >= 2}
            title="Attach an image (the AI can read it)"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-lg ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 disabled:opacity-40"
            aria-label="Attach image"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input, attachments);
              }
            }}
            rows={1}
            placeholder={attachments.length ? 'Describe the image…' : 'Ask about your CGPA, target, next semester…'}
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border-0 bg-white px-4 py-3 text-[13px] font-medium text-slate-800 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          {thinking ? (
            <button
              onClick={stopGeneration}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-800 text-base text-white shadow-sm transition hover:bg-slate-700 active:scale-95"
              aria-label="Stop generating"
              title="Stop"
            >
              ■
            </button>
          ) : (
            <button
              onClick={() => void send(input, attachments)}
              disabled={thinking || (!input.trim() && !attachments.length)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-lg text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:opacity-40"
              aria-label="Send"
            >
              ➤
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-center text-[10px] leading-snug text-slate-400">
          🔒 {status.notice || 'Your tool data is sent to the AI provider only when you ask a question — it is never stored by the app.'}
          {meta && <span className="ml-1 opacity-70">· {meta.provider} · {meta.model}</span>}
        </p>
      </div>

      {/* ── History drawer (hamburger) ──────────────────────────────────── */}
      {historyOpen && (
        <div className="fixed inset-0 z-[90] flex bg-slate-900/50 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <div className="flex h-full w-full max-w-xs flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-sm font-black text-slate-800">🕘 Chat history</h3>
              <button onClick={() => setHistoryOpen(false)} className="rounded-lg px-2 py-1 text-xs font-black text-slate-400 hover:bg-slate-100">
                ✕
              </button>
            </div>
            <div className="border-b border-slate-100 p-3">
              <button
                onClick={() => {
                  setHistory(startNewConversation(history));
                  setHistoryOpen(false);
                  setError(null);
                }}
                className="w-full rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99]"
              >
                ＋ New chat
              </button>
              <p className="mt-1.5 text-center text-[10px] font-semibold text-slate-400">
                Old chats are kept on this device. Only 🔄 Clear wipes them.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {history.convs.length === 0 && <p className="px-2 py-6 text-center text-[11px] font-semibold text-slate-400">No conversations yet.</p>}
              <div className="space-y-1">
                {[...history.convs]
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((c) => (
                    <div
                      key={c.id}
                      className={`group flex items-center gap-1 rounded-xl px-2 py-2 ring-1 transition ${
                        c.id === history.activeId ? 'bg-brand-50 ring-brand-200' : 'ring-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <button
                        onClick={() => {
                          setHistory(openConversation(history, c.id));
                          setHistoryOpen(false);
                          setError(null);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[12px] font-black text-slate-800">{c.title}</span>
                        <span className="block text-[10px] font-semibold text-slate-400">
                          {c.messages.length} message{c.messages.length === 1 ? '' : 's'} · {timeAgo(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this conversation?')) {
                            setHistory(deleteConversation(history, c.id));
                            setError(null);
                          }
                        }}
                        className="shrink-0 rounded-lg px-1.5 py-1 text-[11px] font-black text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                        title="Delete conversation"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────

function HeaderBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-full bg-white text-sm ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function MsgBubble({ role, text, images }: { role: 'user' | 'assistant'; text: string; images?: string[] }) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          role === 'user' ? 'rounded-br-md bg-brand-600 text-white shadow-sm' : 'rounded-bl-md bg-slate-100 text-slate-800 ring-1 ring-slate-200/60'
        }`}
      >
        {images && images.length > 0 && (
          <div className={`mb-1.5 flex flex-wrap gap-1.5 ${role === 'user' ? 'justify-end' : ''}`}>
            {images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" title="Open image">
                <img src={src} alt={`image ${i + 1}`} className="h-24 w-24 rounded-lg object-cover ring-1 ring-white/40" />
              </a>
            ))}
          </div>
        )}
        {text ? (role === 'assistant' ? <Markdown text={text} /> : text) : null}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Compress an image to a ≤1024px JPEG data-URL (keeps device history small). */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 12_000_000) {
      reject(new Error('image too large'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1024;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

function QuickTab({ icon, label, hint, onClick }: { icon: string; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl bg-white p-2 text-left ring-1 ring-red-200 transition hover:bg-red-50 active:scale-[0.98]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-100/70 text-base">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-black text-red-700">{label}</span>
        <span className="block truncate text-[9px] font-semibold text-red-500/80">{hint}</span>
      </span>
    </button>
  );
}

// ── Minimal Markdown renderer (bold, italic, code, lists, LINKS, TABLES) ──

function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: React.ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  let tableBuf: string[] = [];
  let k = 0;

  const flushList = () => {
    if (!listBuf) return;
    const items = listBuf.items;
    const ordered = listBuf.ordered;
    out.push(
      ordered ? (
        <ol key={`l${k++}`} className="ml-4 list-decimal space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l${k++}`} className="ml-4 list-disc space-y-0.5">
          {items.map((it, i) => (
            <li key={i}>{renderInline(it, `li${i}`)}</li>
          ))}
        </ul>
      )
    );
    listBuf = null;
  };

  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf
      .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      .filter((cells) => cells.length && !(cells.length === 1 && /^[\s:|-]+$/.test(cells[0])));
    // Drop the |---| separator row (all cells dashes/colons).
    const clean = rows.filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
    if (clean.length) {
      const [head, ...body] = clean;
      out.push(
        <div key={`t${k++}`} className="my-1 overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i} className="border-b border-slate-200 bg-slate-50 px-2 py-1 text-left font-black text-slate-700">
                    {renderInline(c, `th${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((cells, ri) => (
                <tr key={ri} className={ri % 2 ? 'bg-slate-50/60' : ''}>
                  {cells.map((c, ci) => (
                    <td key={ci} className="border-b border-slate-100 px-2 py-1 text-slate-700">
                      {renderInline(c, `td${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    tableBuf = [];
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const isTable = /^\s*\|.*\|\s*$/.test(line);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (isTable) {
      flushList();
      tableBuf.push(line);
      return;
    }
    flushTable();
    if (ul || ol) {
      const ordered = !!ol;
      if (!listBuf || listBuf.ordered !== ordered) {
        flushList();
        listBuf = { ordered, items: [] };
      }
      listBuf.items.push((ul ?? ol)![1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
    out.push(<p key={`p${k++}`}>{renderInline(line, `p${k}`)}</p>);
  });
  flushList();
  flushTable();

  return <div className="space-y-1.5">{out}</div>;
}

function renderInline(text: string, key: string): React.ReactNode {
  // Split on inline tokens: `code`, **bold**, *italic*, [label](url)
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let kk = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      parts.push(
        <code key={`${key}-${kk++}`} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('**')) {
      parts.push(<strong key={`${key}-${kk++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (mm) {
        parts.push(
          <a key={`${key}-${kk++}`} href={mm[2]} target="_blank" rel="noreferrer" className="underline decoration-brand-300 underline-offset-2">
            {mm[1]}
          </a>
        );
      } else {
        parts.push(tok);
      }
    } else {
      parts.push(<em key={`${key}-${kk++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
