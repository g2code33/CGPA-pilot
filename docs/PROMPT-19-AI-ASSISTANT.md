# Prompt 19 — Deployment Accuracy (Drafts + Preview) & CGPA Pilot AI

Three capabilities in this release:

1. **Accurate deployment** — the admin can **save work to drafts** and
   **preview exactly what changed** (working catalog vs what students see
   today) before publishing.
2. **CGPA Pilot AI** — a student-facing AI section that knows the user's
   current tool data and answers academic questions about it.
3. **Admin AI settings** — the admin configures providers + **key pools**
   (many keys per provider, round-robin, so plenty of users get served) and
   regulates the feature (enable/disable, notice, rate limit, temperature,
   context sharing).

---

## 1 · Drafts + Preview ("accurate deployment only")

### Save to Draft
The admin save bar now has **📝 Save Draft**: a named snapshot of the working
catalog is stored **on the backend** (`D1 → admin_drafts`) and mirrored to the
admin's **localStorage** (`synced` flag). Drafts survive device loss; the local
mirror works offline and is re-synced on the next backend save.
**📥 Drafts** opens the list: every draft can be **Restored** into the working
catalog, **Previewed** (against what's published), or **Deleted** (backend +
local).

### Preview Changes
**🔍 Preview changes** resolves the *published* reference (the localStorage
published-snapshot, written on every successful publish/pull/backend adoption;
falling back to a read-only `GET /api/admin/catalog`) and renders a
field-level diff:

- Universities: added / removed / changed (name, shortName, grading,
  classification, schools, programmes)
- Curricula: added / removed / status transitions / **course-level**
  added / removed / modified (matched by course code)
- Appearance (branding, logo, wordmark) and Settings
- "No changes" state when the working catalog matches what's published

The preview modal's **Publish** button is disabled unless there are real
changes — the admin cannot publish blind.

### Accuracy guarantees
- id-bearing arrays are matched by id (reordering is **not** a change)
- index arrays (bands, etc.) compared positionally
- nested entities diffed recursively; `before → after` values shown

Tests: `test/catalogDiff.test.mjs`.

---

## 2 · CGPA Pilot AI (student)

A new tool screen after **Milestones** (🤖 AI Assistant). It:

- reads the **public status** from `GET /api/ai/status` (20 s shared cache —
  app shell and screen always agree);
- is **hidden from the tool list only when the admin disabled it** —
  offline/unknown shows the screen, which explains the state;
- builds the answer context from the **current tool data**
  (`src/services/aiContext.ts`): institution, input mode, confirmed CGPA +
  credits + classification, level/semester position, per-semester GPA/credits
  + pending courses, target CGPA, planned next-semester credits;
- when the user's tools are **empty**, the assistant says so and offers
  **quick tabs** (Calculate, Target, Next, What-If) that navigate to fill
  the tools;
- chat is **in-memory only** — nothing is persisted (consistent with the
  no-storage policy);
- the privacy screen has a dedicated **AI disclosure card**.

### How a question flows
1. `POST /api/ai/chat {messages, context}` → the **Worker** (keys never
   leave it) proxies to the selected provider in **worker mode**, or
2. in **direct mode** (local/Ollama-style endpoints students' devices can
   reach, e.g. `http://localhost:11434`) the Worker answers
   `{code:'use-direct'}` and the **client** calls the endpoint itself
   (`/chat/completions` OpenAI-compatible or `/v1/messages` Anthropic).

Client error codes: `ai-unavailable`, `no-provider`, `no-keys`,
`rate-limited (+retryAfterSec)`, `bad-request`, `provider-error`,
`offline`, `direct-error`.

**Design note (gap, deliberate):** in direct mode the provider is local to
the student's device, so the admin **persona/system prompt** is sent by the
client but key material is the local one; remote direct providers are not
supported (endpoint must be reachable from the student device).

---

## 3 · Admin AI Settings (🤖 AI Assistant nav item)

`src/admin/views/AiSettings.tsx` — everything saved via
`POST /api/admin/ai` (server-side validation, version bump) and read back
with `GET /api/admin/ai`; **no catalog publish required** — the public
status reflects saves instantly.

### Regulation
- **Enable / disable** the whole feature (students see the notice text when
  disabled)
- label, **privacy notice** (shown to students), `maxMessagesPerHour`
  (sliding-window, per IP), `temperature`, `maxTokens`, **sendContext**
  (when off, answers without the student's tool data)
- custom **system prompt / persona** (+ reset to default)

### Providers + key pools
- 10 presets covering the **free tiers** (NVIDIA NIM, Groq, Cerebras,
  Mistral La Plateforme, OpenRouter `:free`, Google Gemini, Hugging Face,
  Ollama-local, OpenAI, Anthropic) — every provider is an
  OpenAI-compatible `baseUrl + model` (or Anthropic) with an arbitrary
  label, so **any** OpenAI-compatible endpoint works
- each provider holds a **pool of keys** (add many) — the Worker rotates
  round-robin across users and puts a key in a 5-minute cooldown after
  401/403/429, so a pool of N keys serves N× the traffic
- per-key **Test** button (single request, key value never echoed back in
  public responses — the public status exposes labels only in worker mode;
  direct mode intentionally carries endpoint + key to the client)
- "make default" per provider; providers individually enable/disable

### Storage & privacy
- `ai_settings`: single D1 row, admin-only endpoints
- public status never contains worker-mode keys
- chat messages are never persisted server-side (request → response, nothing
  stored)

Tests: `test/workerAi.test.mjs` (status, settings CRUD, validation, key
rotation, exhaustion, rate limit, drafts CRUD), `test/aiContext.test.mjs`.

---

## Verification

- `npx tsc -p tsconfig.json / electron/tsconfig.json / worker/tsconfig.json` — all clean
- `node --test` — **354 pass / 0 fail**
- `npm run build` (web) + `build:electron` — green
- `npm run smoke` — all gates pass (including: views have no hard-coded
  grading values; student services never write student values to URLs/network)
