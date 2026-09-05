// ─────────────────────────────────────────────────────────────────────────
// aiHistory — the student's AI conversation history (device-only):
//
//   load empty / corrupt        → empty, never throws
//   append + title              → first user message becomes the title
//   new chat                    → fresh thread, OLD ones stay (revisitable)
//   open (resume)               → back to an old thread, keeps appending there
//   delete                      → active swap; others untouched
//   bounds                      → ≤30 convs (active never dropped) and, when
//                                 serialized history is huge, images are
//                                 dropped from the OLDEST non-active threads
//                                 (text kept), then whole oldest convs
//   clear                       → wipes the storage key (🔄 Clear button)
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalStorage } from './helpers/fixtures.mjs';

// Browser shim — configCache is the only module that touches storage, and it
// references bare `localStorage`; Node 22 lets us define that global.
const ls = makeLocalStorage();
globalThis.localStorage = ls;
const KEY = 'cgpa-pilot-ai-history-v1';

const history = await import('../src/services/aiHistory.ts');
const cache = await import('../src/services/configCache.ts');

function reset() {
  ls.clear();
}

test('load with no history → empty doc', () => {
  reset();
  const doc = history.loadAiHistory();
  assert.deepEqual(doc, { activeId: null, convs: [] });
});

test('load with corrupt history → empty doc (never throws)', () => {
  reset();
  ls.setItem(KEY, '{not-json!!');
  assert.deepEqual(history.loadAiHistory(), { activeId: null, convs: [] });
});

test('append creates the conversation and titles it from the first user message', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'What is my CGPA?' });
  assert.equal(doc.convs.length, 1);
  assert.equal(doc.activeId, doc.convs[0].id);
  assert.equal(doc.convs[0].title, 'What is my CGPA?');
  assert.equal(doc.convs[0].messages.length, 1);
  // assistant reply goes into the SAME thread
  doc = history.appendMessage(doc, { role: 'assistant', text: 'Your CGPA is 3.42.' });
  assert.equal(doc.convs.length, 1);
  assert.equal(doc.convs[0].messages.length, 2);
  assert.equal(doc.convs[0].messages[1].role, 'assistant');
  // persisted to storage
  assert.ok(ls.getItem(KEY).includes('Your CGPA is 3.42.'));
});

test('long first user message → title is truncated with an ellipsis', () => {
  reset();
  const doc = history.appendMessage(history.loadAiHistory(), {
    role: 'user',
    text: 'Please explain in very long detail why my second semester GPA dropped so badly and what to do'.replace(/ /g, 'x '),
  });
  assert.equal(doc.convs[0].title.length, 43); // 42 chars + '…'
  assert.ok(doc.convs[0].title.endsWith('…'));
});

test('new chat starts a fresh thread; the old one is kept and resumable', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'Old question' });
  const oldId = doc.convs[0].id;

  doc = history.startNewConversation(doc);
  assert.equal(doc.convs.length, 2);
  assert.notEqual(doc.activeId, oldId);
  assert.ok(doc.convs.some((c) => c.id === oldId), 'old conversation kept');

  // resume the old thread and append there
  doc = history.openConversation(doc, oldId);
  assert.equal(doc.activeId, oldId);
  doc = history.appendMessage(doc, { role: 'assistant', text: 'still here' });
  const old = doc.convs.find((c) => c.id === oldId);
  assert.equal(old.messages.length, 2);
  assert.equal(old.messages[1].text, 'still here');
});

test('open with an unknown id is a no-op', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'q' });
  const before = JSON.stringify(doc);
  assert.equal(JSON.stringify(history.openConversation(doc, 'nope')), before);
});

test('deleting the active conversation activates the most recent other', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'first' });
  const firstId = doc.convs[0].id;
  doc = history.startNewConversation(doc);
  doc = history.appendMessage(doc, { role: 'user', text: 'second' });
  const secondId = doc.convs[0].id;
  assert.notEqual(firstId, secondId);

  doc = history.deleteConversation(doc, secondId); // delete the active one
  assert.equal(doc.convs.length, 1);
  assert.equal(doc.activeId, firstId);

  doc = history.deleteConversation(doc, firstId); // delete the last one
  assert.equal(doc.convs.length, 0);
  assert.equal(doc.activeId, null);
});

test('deleting a non-active conversation keeps the active one', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'keep me' });
  const keepId = doc.convs[0].id;
  doc = history.startNewConversation(doc);
  doc = history.appendMessage(doc, { role: 'user', text: 'delete me' });
  doc = history.deleteConversation(doc, doc.activeId);
  assert.equal(doc.activeId, keepId);
  assert.equal(doc.convs.length, 1);
});

test('conversation count is capped (oldest first, active never dropped)', () => {
  reset();
  let doc = history.loadAiHistory();
  for (let i = 0; i < 35; i++) {
    doc = history.startNewConversation(doc);
    doc = history.appendMessage(doc, { role: 'user', text: `chat ${i}` });
  }
  // saved doc (what's on disk) is capped at 30 and still has the active thread
  const onDisk = JSON.parse(ls.getItem(KEY));
  assert.ok(onDisk.convs.length <= 30);
  assert.ok(onDisk.convs.some((c) => c.id === doc.activeId), 'active thread survives the cap');
});

test('huge history → images dropped from OLDEST non-active threads, text kept', () => {
  reset();
  // Fake data-URL images of ~0.9 MB of text each.
  const imgA = `data:image/jpeg;base64,${'A'.repeat(900_000)}`;
  const imgB = `data:image/jpeg;base64,${'B'.repeat(900_000)}`;
  const imgC = `data:image/jpeg;base64,${'C'.repeat(900_000)}`;

  let doc = history.loadAiHistory();
  doc = history.appendMessage(doc, { role: 'user', text: 'first question', images: [imgA] });
  const firstId = doc.activeId;
  doc = history.startNewConversation(doc);
  doc = history.appendMessage(doc, { role: 'user', text: 'second question', images: [imgB] });
  const secondId = doc.activeId;
  // Two ~0.9 MB images stored so far — still under the 2.4 MB quota.
  assert.ok(ls.getItem(KEY).length < 2_400_000);

  // Third thread (the ACTIVE one) gets its own big image → total > 2.4 MB,
  // so the save must trim — dropping images from the OLDEST non-active
  // thread (the first one), keeping everything else.
  doc = history.startNewConversation(doc);
  doc = history.appendMessage(doc, { role: 'user', text: 'third question', images: [imgC] });
  const activeId = doc.activeId;

  const onDisk = JSON.parse(ls.getItem(KEY));
  const first = onDisk.convs.find((c) => c.id === firstId);
  const second = onDisk.convs.find((c) => c.id === secondId);
  const active = onDisk.convs.find((c) => c.id === activeId);
  // The OLDEST thread's image was dropped, its text kept…
  assert.equal(first.messages[0].images.length, 0);
  assert.equal(first.messages[0].text, 'first question');
  // …the newer non-active thread's image survived…
  assert.equal(second.messages[0].images.length, 1);
  // …and did the ACTIVE thread's…
  assert.equal(active.messages[0].images.length, 1);
  // …and the whole thing now fits under the quota.
  assert.ok(ls.getItem(KEY).length <= 2_400_000);
});

test('clearAiHistory wipes the storage key (the 🔄 Clear button)', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'hello' });
  doc = history.appendMessage(doc, { role: 'assistant', text: 'hi' });
  assert.ok(ls.getItem(KEY));
  const cleared = history.clearAiHistory();
  assert.deepEqual(cleared, { activeId: null, convs: [] });
  assert.ok(!ls.getItem(KEY), 'history content removed');
  // wipeDeviceStorage (the app-wide Clear) removes the same key.
  history.appendMessage(cleared, { role: 'user', text: 'again' });
  assert.ok(ls.getItem(KEY));
  cache.wipeDeviceStorage();
  assert.equal(ls.getItem(KEY), null);
});

test('loadAiHistory falls back to the first conversation when activeId is stale', () => {
  reset();
  let doc = history.appendMessage(history.loadAiHistory(), { role: 'user', text: 'a' });
  const firstId = doc.convs[0].id;
  doc = history.startNewConversation(doc);
  // corrupt the active pointer by hand
  const raw = JSON.parse(ls.getItem(KEY));
  raw.activeId = 'ghost';
  ls.setItem(KEY, JSON.stringify(raw));
  const reloaded = history.loadAiHistory();
  assert.ok(reloaded.convs.some((c) => c.id === firstId));
  assert.notEqual(reloaded.activeId, 'ghost');
});
