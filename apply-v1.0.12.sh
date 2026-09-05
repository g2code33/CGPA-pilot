#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
#  CGPA PILOT — one-shot updater: v1.0.12
#  (AI Test: shows the provider's REAL error · stops the misleading 502)
#
#  HOW TO RUN (3 steps):
#    1. Open the CGPA-pilot folder in VS Code.
#    2. Open the terminal:  Ctrl + `   (the backtick key, next to 1)
#       → the terminal already starts INSIDE the project folder.
#    3. Type:   bash apply-v1.0.12.sh    and press Enter.
# ══════════════════════════════════════════════════════════════════════════
set -eu

echo "----------------------------------------"
echo " CGPA Pilot updater — v1.0.12"
echo "----------------------------------------"

# ── 1. Find the repo (walks up from where you are) ─────────────────────────
REPO=""
DIR="$(pwd)"
while :; do
  if [ -d "$DIR/.git" ] && [ -f "$DIR/package.json" ] && grep -q "cgpa-pilot" "$DIR/package.json"; then
    REPO="$DIR"
    break
  fi
  [ "$DIR" = "/" ] && break
  DIR="$(dirname "$DIR")"
done

if [ -z "$REPO" ]; then
  echo ""
  echo "  I could not find the CGPA-pilot folder."
  echo ""
  echo "  Open the CGPA-pilot folder in VS Code, press Ctrl+\` (backtick)"
  echo "  to open the terminal, and run this script again."
  exit 1
fi
cd "$REPO"
echo "  Repo found: $REPO"
echo ""

# ── 2. Safety: don't touch uncommitted work ────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "  STOP — this folder has uncommitted changes:"
  git status --short | head -10
  echo ""
  echo "  Commit or stash them first (I never touch your work), then re-run me."
  exit 1
fi

# ── 3. Get the latest main ─────────────────────────────────────────────────
echo "  Updating from GitHub (main)..."
git checkout main
git pull origin main

# ── 4. Skip if already applied ─────────────────────────────────────────────
if grep -q "detail: res.error.slice(0, 240)" worker/src/ai.ts 2>/dev/null; then
  echo ""
  echo "  v1.0.12 is already applied — nothing to do. You're up to date."
  exit 0
fi

# ── 5. Apply the v1.0.12 patch ─────────────────────────────────────────────
echo "  Applying v1.0.12 (AI test: real provider error, no more 502)..."
PATCH=".v1.0.12-update.patch"
cat > "$PATCH" << 'CGPA_PATCH_EOF'
diff --git a/package.json b/package.json
index 52cc630..34c7532 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "cgpa-pilot",
-  "version": "1.0.11",
+  "version": "1.0.12",
   "private": true,
   "author": {
     "name": "CGPA Pilot",
diff --git a/src/admin/adminApi.ts b/src/admin/adminApi.ts
index 2634a82..f393273 100644
--- a/src/admin/adminApi.ts
+++ b/src/admin/adminApi.ts
@@ -638,7 +638,7 @@ export async function testAiKey(
   provider: AiProvider,
   keyValue: string,
   deps: AdminApiDeps = {}
-): Promise<{ ok: boolean; message: string; model?: string; ms?: number }> {
+): Promise<{ ok: boolean; message: string; detail?: string; model?: string; ms?: number }> {
   // Sends the provider + key exactly as the admin has them ON SCREEN —
   // testing works before the settings are saved (the Worker sanitizes the
   // same way it does on save).
@@ -653,7 +653,7 @@ export async function testAiKey(
       headers: { ...headers(deps), 'content-type': 'application/json' },
       body: JSON.stringify({ provider, keyValue }),
     });
-    const doc = (await safeJson(res)) as { ok: boolean; message: string; model?: string; ms?: number } | null;
+    const doc = (await safeJson(res)) as { ok: boolean; message: string; detail?: string; model?: string; ms?: number } | null;
     if (res.status === 401) return { ok: false, message: 'Sign in again — your admin session expired.' };
     return doc ?? { ok: false, message: `Test failed (HTTP ${res.status}).` };
   } catch {
diff --git a/src/admin/views/AiSettings.tsx b/src/admin/views/AiSettings.tsx
index 2528f46e..c6dd52e 100644
--- a/src/admin/views/AiSettings.tsx
+++ b/src/admin/views/AiSettings.tsx
@@ -294,9 +294,15 @@ export function AiSettings({ toast }: { toast: Toast }) {
                     return;
                   }
                   // Test the provider + key exactly as they are on screen —
-                  // no need to save first.
+                  // no need to save first. On failure, show the provider's
+                  // RAW error (detail) too — that is the evidence, the
+                  // friendly message is just a translation of it.
                   const r = await testAiKey(p, key.value);
-                  toast(r.ok ? `✅ ${keyLabel}: ${r.message}` : `⛔ ${keyLabel}: ${r.message}`);
+                  if (r.ok) toast(`✅ ${keyLabel}: ${r.message}`);
+                  else {
+                    const detail = r.detail ? ` · provider said: ${r.detail.slice(0, 160)}` : '';
+                    toast(`⛔ ${keyLabel}: ${r.message}${detail}`);
+                  }
                 }}
               />
             ))}
diff --git a/test/workerAi.test.mjs b/test/workerAi.test.mjs
index 40d2f23..c9de132 100644
--- a/test/workerAi.test.mjs
+++ b/test/workerAi.test.mjs
@@ -462,3 +462,44 @@ test('drafts: save → list → fetch → delete', async () => {
   res = await worker.fetch(req('/api/admin/drafts/d1', { method: 'GET', token: TOKEN }), e);
   assert.equal(res.status, 404);
 });
+
+test('test endpoint: rejected key → 200 with ok:false + the provider raw error (detail)', async () => {
+  const e = env();
+  __resetAi();
+  const provider = {
+    id: 'prov-test',
+    preset: 'nvidia-nim',
+    label: 'NVIDIA NIM (free)',
+    type: 'openai-compatible',
+    mode: 'worker',
+    baseUrl: 'https://integrate.api.nvidia.com/v1',
+    model: 'meta/llama-3.3-70b-instruct',
+    keys: [],
+    enabled: true,
+  };
+  const { f } = mockProvider([{ errorStatus: 401, errorMessage: 'Invalid API key provided' }]);
+  const realFetch = globalThis.fetch;
+  globalThis.fetch = f;
+  try {
+    const res = await worker.fetch(
+      req('/api/admin/ai/test', {
+        method: 'POST',
+        token: TOKEN,
+        body: { provider, keyValue: 'nvapi-12345678' },
+      }),
+      e
+    );
+    // A failed KEY TEST is a normal, successful HTTP response — the result
+    // is in the body. No more 502 noise in the admin console.
+    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
+    const out = await j(res);
+    assert.equal(out.ok, false);
+    assert.match(out.message, /rejected the API key/i);
+    // The provider's RAW error is surfaced for diagnosis.
+    assert.match(out.detail ?? '', /HTTP 401/);
+    assert.match(out.detail ?? '', /Invalid API key provided/);
+  } finally {
+    globalThis.fetch = realFetch;
+    __resetAi();
+  }
+});
diff --git a/worker/src/ai.ts b/worker/src/ai.ts
index 267fea3..b8bb31c 100644
--- a/worker/src/ai.ts
+++ b/worker/src/ai.ts
@@ -403,12 +403,15 @@ export async function testAiKey(
   provider: AiProvider,
   key: AiKey,
   system: string
-): Promise<{ ok: boolean; message: string; model?: string; ms?: number }> {
+): Promise<{ ok: boolean; message: string; detail?: string; model?: string; ms?: number }> {
   const res = await callProvider(f, provider, key, system, [{ role: 'user', content: 'Reply with the single word: ready' }], 24, 0);
   if (res.ok) {
     return { ok: true, message: `Connected — “${res.text.slice(0, 60)}”`, model: provider.model, ms: res.ms };
   }
-  return { ok: false, message: friendlyProviderError(res.error) };
+  // `detail` carries the provider's RAW error (HTTP status + body) so the
+  // admin can see exactly what the provider said — the friendly `message`
+  // is a guess, the detail is the evidence.
+  return { ok: false, message: friendlyProviderError(res.error), detail: res.error.slice(0, 240) };
 }
 
 export { publicAiStatus };
diff --git a/worker/src/index.ts b/worker/src/index.ts
index cca39f6..b6a2465 100644
--- a/worker/src/index.ts
+++ b/worker/src/index.ts
@@ -590,7 +590,9 @@ async function handleApi(req: Request, url: URL, env: Env): Promise<Response> {
         const key: AiKey = { id: 'test', label: 'test', value: b.keyValue.trim() };
         if (!key.value) return json({ ok: false, message: 'Enter the API key value first, then Test.' });
         const res = await testAiKey(fetch, { ...prov, keys: [key] }, key, current.systemPrompt);
-        return json(res, res.ok ? 200 : 502);
+        // The test REQUEST succeeded — the RESULT (res.ok) says whether the
+        // key works. A failed test is not an HTTP error (no 502 noise).
+        return json(res);
       }
 
       // Legacy: test a SAVED provider/key by id.
@@ -605,7 +607,7 @@ async function handleApi(req: Request, url: URL, env: Env): Promise<Response> {
         return json({ ok: false, error: 'not-found', message: 'Unknown key for that provider.' }, 404);
       }
       const res = await testAiKey(fetch, provider, key, current.systemPrompt);
-      return json(res, res.ok ? 200 : 502);
+      return json(res);
     }
 
     return json({ ok: false, error: 'method-not-allowed' }, 405);
CGPA_PATCH_EOF

if ! git apply --check "$PATCH"; then
  rm -f "$PATCH"
  echo ""
  echo "  The patch does not apply cleanly — main may have moved."
  echo "  Send me this output from:  git log --oneline -3"
  exit 1
fi
git apply "$PATCH"
rm -f "$PATCH"

# ── 6. Commit + push ────────────────────────────────────────────────────────
echo "  Committing and pushing..."
git add -A
git commit -m "v1.0.12: AI test shows the provider's real error (no more misleading 502)"
git push origin main

echo ""
echo "  ================================================"
echo "  DONE — v1.0.12 is on main."
echo "  ================================================"
echo ""
echo "  Cloudflare redeploys automatically (~1-2 minutes)."
echo ""
echo "  NEXT STEPS:"
echo "   1. Wait about 2 minutes."
echo "   2. Hard-refresh the admin console:  Ctrl+Shift+R"
echo "   3. AI Assistant → paste your key → TEST."
echo "   4. If it fails, the message now shows exactly what the"
echo "      provider said (e.g. 'provider said: HTTP 401: ...')."
echo "      Send me that message and we finish it in one shot."
echo ""