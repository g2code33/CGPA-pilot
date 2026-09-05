// ─────────────────────────────────────────────────────────────────────────
// aiHistory — the student's AI conversation history, kept on THIS device.
//
//   • The AI keeps every conversation so the student can always come back.
//   • A "New chat" starts a fresh thread; the old one stays in the history
//     (hamburger → open) and can be resumed.
//   • The ONLY thing that wipes it is the app's 🔄 Clear button (which calls
//     wipeDeviceStorage → clears this key). Nothing else ever drops it.
//   • Storage stays bounded: when the serialized history nears the quota we
//     trim the OLDEST conversations (never the active one) and, if still
//     large, drop attached images from old threads (text is kept).
//
// All persistence goes through configCache.ts (the app's single storage
// boundary) so the privacy smoke-test invariant still holds.
// ─────────────────────────────────────────────────────────────────────────

import { readAiHistoryRaw, saveAiHistoryRaw } from './configCache';

export interface AiMsg {
  id: string;
  role: 'user' | 'assistant';
  /** The message text (assistant answers / user questions). */
  text: string;
  /** Data-URL images attached to a USER message (may be trimmed to save space). */
  images?: string[];
  ts: number;
}

export interface AiConv {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiMsg[];
}

export interface AiHistory {
  activeId: string | null;
  convs: AiConv[];
}

/** Hard ceiling for the serialized history (chars). ~2.4 MB keeps a margin. */
const MAX_HISTORY_CHARS = 2_400_000;
/** Keep at most this many conversations (oldest trimmed first). */
const MAX_CONVS = 30;

const EMPTY: AiHistory = { activeId: null, convs: [] };

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFrom(firstUser: AiMsg | undefined): string {
  const t = firstUser?.text?.trim();
  if (!t) return 'New chat';
  const one = t.replace(/\s+/g, ' ');
  return one.length > 42 ? `${one.slice(0, 42)}…` : one;
}

/** Load history from device storage (defensive: any corruption → empty). */
export function loadAiHistory(): AiHistory {
  const raw = readAiHistoryRaw();
  if (!raw) return { ...EMPTY, convs: [] };
  try {
    const doc = JSON.parse(raw) as AiHistory;
    if (!doc || !Array.isArray(doc.convs)) return { ...EMPTY, convs: [] };
    const convs = doc.convs.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
    const activeId = typeof doc.activeId === 'string' && convs.some((c) => c.id === doc.activeId) ? doc.activeId : convs[0]?.id ?? null;
    return { activeId, convs };
  } catch {
    return { ...EMPTY, convs: [] };
  }
}

/** Persist history, trimming to fit the quota. Returns the stored doc. */
export function saveAiHistory(doc: AiHistory): AiHistory {
  let out: AiHistory = { ...doc, convs: [...doc.convs] };
  // 1) Cap conversation count (never drop the active thread).
  if (out.convs.length > MAX_CONVS) {
    const sorted = [...out.convs].sort((a, b) => a.updatedAt - b.updatedAt);
    const drop = new Set(sorted.slice(0, out.convs.length - MAX_CONVS).map((c) => c.id));
    if (out.activeId && drop.has(out.activeId)) drop.delete(out.activeId);
    out.convs = out.convs.filter((c) => !drop.has(c.id));
  }
  // 2) If still too large, drop images from the OLDEST non-active threads
  //    first (text is always kept).
  while (JSON.stringify(out).length > MAX_HISTORY_CHARS && out.convs.length) {
    const withImages = out.convs
      .filter((c) => c.id !== out.activeId && c.messages.some((m) => m.images?.length))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    const target = withImages[0];
    if (!target) break;
    const cleaned: AiConv = { ...target, messages: target.messages.map((m) => (m.images?.length ? { ...m, images: [] } : m)) };
    out.convs = out.convs.map((c) => (c.id === target.id ? cleaned : c));
  }
  // 3) Extreme case: still over → drop whole oldest NON-ACTIVE conversations
  //    (never the thread the student is in) until it fits.
  while (JSON.stringify(out).length > MAX_HISTORY_CHARS) {
    const oldest = [...out.convs]
      .filter((c) => c.id !== out.activeId)
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!oldest) break; // only the active thread is left — keep it anyway
    out.convs = out.convs.filter((c) => c.id !== oldest.id);
  }
  saveAiHistoryRaw(JSON.stringify(out));
  return out;
}

/** Start a brand-new active conversation (old ones are kept for revisit). */
export function startNewConversation(doc: AiHistory): AiHistory {
  const now = Date.now();
  const conv: AiConv = { id: uid('conv'), title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
  const next: AiHistory = { activeId: conv.id, convs: [conv, ...doc.convs] };
  return saveAiHistory(next);
}

/** Switch the active conversation (resume an old thread). */
export function openConversation(doc: AiHistory, id: string): AiHistory {
  if (!doc.convs.some((c) => c.id === id)) return doc;
  const next: AiHistory = { ...doc, activeId: id };
  return saveAiHistory(next);
}

/** Append a message to the active conversation (creating it if needed). */
export function appendMessage(doc: AiHistory, msg: Omit<AiMsg, 'id' | 'ts'>): AiHistory {
  const now = Date.now();
  let conv = doc.convs.find((c) => c.id === doc.activeId);
  if (!conv) {
    const created: AiConv = { id: uid('conv'), title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
    conv = created;
  }
  const full: AiMsg = { ...msg, id: uid('msg'), ts: now };
  const title = conv.messages.length === 0 && msg.role === 'user' ? titleFrom(full) : conv.title;
  const updated: AiConv = { ...conv, title, updatedAt: now, messages: [...conv.messages, full] };
  const convs = conv.messages.length === 0 && !doc.convs.some((c) => c.id === conv!.id)
    ? [updated, ...doc.convs]
    : doc.convs.map((c) => (c.id === updated.id ? updated : c));
  const next: AiHistory = { activeId: updated.id, convs };
  return saveAiHistory(next);
}

/** Delete a conversation. If it was active, activate the most recent other. */
export function deleteConversation(doc: AiHistory, id: string): AiHistory {
  const remaining = doc.convs.filter((c) => c.id !== id);
  const activeId = doc.activeId === id ? (remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null) : doc.activeId;
  return saveAiHistory({ activeId, convs: remaining });
}

/** Wipe ALL AI history (called by the app's 🔄 Clear button via configCache). */
export function clearAiHistory(): AiHistory {
  saveAiHistoryRaw('');
  return { ...EMPTY, convs: [] };
}
