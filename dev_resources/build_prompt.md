# Build Prompt — Project Acronym Maker

> Hand this whole file to the AI agent that will build the project. It is meant to be complete: the agent should be able to go straight into implementation without asking further questions. Where a detail is not specified, pick the simplest option that fits the rest of this document and note the choice in the final report.

---

## 0. Your mission

Build **Project Acronym Maker**, a single-page web tool that helps a person find an acronym name for their project.

The user answers four questions about their project. A local LLM expands each answer into related words. Those words are displayed as an interactive **node-and-branch mind map**. From the words the user keeps in the map, the app extracts and ranks **acronym candidates**. Everything is saved in a **session** (a saved brainstorm) that can be reopened later.

Build it end to end, in the existing project, in one go.

---

## 1. Hard rules (read first)

1. **Project root:** `F:\trifoldi\projects\project_acronym_maker`. Never create, edit, or delete files outside this directory. If something seems to require it, stop and ask.
2. **Read `AGENTS.md`** in the project root before starting and follow it.
3. **Dev processes:** `npm run dev` (nodemon, port from `.env`, currently `3004`) and `npm run tw` (Tailwind watch) are normally already running. After your edits and before you finish, verify both are still alive. If either has stopped, treat it as crashed and restart it. Only report the work as done once both are confirmed running.
4. **Journal:** add entries to `dev_resources/journal.md` describing what you did. **Each entry must be ≤ 150 characters.** Use several short entries rather than one long one. Follow the existing format (`## YYYY-MM-DD` then `- **HH:MM** — text`), newest date section on top.
5. **Git:** do not commit unless the user asks.
6. **Dependencies:** only add the packages listed in §3. Do not add a frontend framework (no React/Vue), no bundler, no `express-session`/auth library.
7. **Do not touch** `routes/tasks.js`, `models/Task.js`, `dev_resources/tasks.ejs`, `routes/admin.js`, `views/admin/*`, `.vscode/*`, or `project_acronym_maker.vbs`.

---

## 2. The concept, with a worked example

The user describes their project through four questions:

| Key | Question (EN) | Question (FR) | Example answer (FR) |
|---|---|---|---|
| `who` | Who are they? (the people behind / operating the project) | Qui sont-ils ? | une brigade |
| `what` | What do they do? | Que font-ils ? | Ils font de la recherche et de la reconnaissance |
| `how` | How do they do it? | Comment le font-ils ? | Ils utilisent des drones pour recueillir des imageries aériennes |
| `why` | Why do they do it / what solution do they bring? | Pourquoi le font-ils ? Quelle solution apportent-ils ? | Lutter contre les embouteillages et les ralentissements ; aider les secours à comprendre une zone lors d'une catastrophe naturelle |

The LLM expands each answer into related words, for example:

- **who** → Brigade, Escouade, Escadron, Équipe, Bureau, Unité, Peloton
- **what** → Reconnaissance, Inspection, Arpentage, Sondage, Aperçu, Recherche
- **how** → Drone, Imagerie, Flux vidéo, Photographie, Aérien, Capteur
- **why** → Trafic, Fluidité, Secours, Catastrophe, Urgence, Sauvetage

These become a mind map: a root node (the project) → 4 branch nodes (who/what/how/why) → word nodes (which can themselves be expanded into child words).

From the **selected** words, the app builds acronyms. **Any mix of words is allowed**: an acronym does not have to use one word per question, and the order is free. Covering more branches is a bonus in ranking, not a requirement.

Example output: `SERA` → **S**ecours · **E**scouade · **R**econnaissance · **A**érien.

---

## 3. Current state of the project

Already set up and working:

- **Stack:** Node.js + Express 5, EJS, Mongoose 9 (MongoDB), Tailwind CSS v4 via `@tailwindcss/cli`, nodemon, dotenv, concurrently.
- **`server.js`:** mounts "facades" (`/` public, `/app` app, `/admin` admin, `/dev-resources` tasks). Each router exposes `router.routes = [{ method, path, label }]`, which is printed as a route map on startup. **Keep this pattern** and add your new routers to it (including the API router).
- **Mongo:** connects only if `MONGO_URI` is set (`dbName: 'project_acronym_maker'`).
- **Views:** `views/partials/head.ejs` and `foot.ejs` wrap every page (header nav + `<main class="mx-auto max-w-5xl ...">`).
- **Tailwind:** `src/input.css` → `public/output.css`, with `@source "../views"` and `@source "../dev_resources"`.
- **`.env`:** `PORT=3004`, `MONGO_URI=mongodb://localhost:27017/project_acronym_maker`, `SESSION_SECRET=`, `NODE_ENV=development`.
- **Placeholder pages:** `/app`, `/app/login`, `/app/acronyms`, `/app/collections`.

**Local LLM runtime:** Ollama `0.32.x` at `http://localhost:11434`. Installed models:

| Model | Size | Use |
|---|---|---|
| `huihui_ai/gemma-4-abliterated:12b` | 7.6 GB | **Default.** Fast, good enough for word expansion. |
| `huihui_ai/Qwen3.6-abliterated:27b` | 17 GB | Stronger, good French. Slower. Qwen3-family: send `"think": false`. |
| `qwen2.5:0.5b` | 0.4 GB | Too small; list it but don't default to it. |

**Measured behaviour:** a cold call to gemma-12b took ~46 s (≈44.7 s loading the model into memory, ≈1.4 s generating). Warm calls take a couple of seconds. The UI and timeouts must account for this (see §6.4).

A verified working request:

```bash
curl -s localhost:11434/api/chat -d '{"model":"huihui_ai/gemma-4-abliterated:12b","stream":false,"think":false,"format":"json","messages":[{"role":"user","content":"Return JSON {\"words\":[...]} with 8 French synonyms or related nouns for: une brigade"}]}'
# → message.content = {"words":["unité","groupe","escouade","détachement","équipe","corps","peloton","division"]}
```

**Packages to install** (all verified to exist on npm):

- `cytoscape` (v3.x): the mind-map graph
- `an-array-of-french-words` (v2.x, ~336k words): French dictionary
- `an-array-of-english-words` (v2.x): English dictionary

Before using the two word-list packages, **inspect their `package.json`/entry file**. v2 may be ESM-only or ship a JSON file. If `require()` fails, read the underlying JSON/text file with `fs` instead. Load each list lazily (on first use) and cache it in memory.

---

## 4. Product requirements

### 4.1 Single page

`/app` becomes the tool: one page, no full reloads, and all interaction through `fetch` to a JSON API.

Layout (desktop): a **left sidebar** (sessions) + a **main column** with three stacked steps. On mobile, the sidebar collapses into a toggleable drawer. For this page, override the `max-w-5xl` container so the tool can use the full width (for example, pass a `wide: true` flag to the partials, or give the page its own wrapper).

### 4.2 Language dropdown

- Options: **Français** (`fr`) and **English** (`en`). Default: `fr`.
- Stored per session.
- It controls: (a) the language of the LLM prompts and generated words/rationales, (b) the dictionary used for real-word acronym detection, and (c) the **UI labels** of the tool page (small client-side i18n dictionary with `fr` and `en` strings for every label, button, placeholder, empty state, and error message).
- Changing the language on a session that already has words does **not** delete them. Show a non-blocking hint that "Generate words" will now produce words in the new language.

### 4.3 Model dropdown

- Populated from Ollama's `GET /api/tags` through the backend.
- Default: `OLLAMA_MODEL` from `.env`.
- Stored per session.
- If Ollama is unreachable, show a clear banner ("Local LLM unavailable — is Ollama running?") and disable the LLM buttons. Manual word entry and acronym generation from existing words must still work.

### 4.4 Sessions (saved brainstorms)

- A "session" is a saved brainstorm, **not** a user account or a login. There is no authentication; all sessions are visible to whoever opens the app.
- Sidebar: list of sessions (title + last-updated date, newest first), a **New session** button, and on each item **rename** and **delete** (with a confirmation).
- The current session id is kept in the URL (`/app?s=<id>`) so reload and bookmarks work. Opening `/app` without `?s=` opens the most recent session, or shows an empty state with "New session" if there are none.
- **Autosave:** answers, language, model, and title save automatically (debounced ~600 ms PATCH). Show a small "Saving… / Saved" indicator.
- Default title: "Untitled session" / "Session sans titre". Once `who` has a value and the title is still default, suggest it as the title (don't overwrite a title the user set).
- If MongoDB is not connected, API routes return `503 { error: 'database_unavailable' }` and the UI shows a clear banner.

### 4.5 Step 1: The four questions

- Four labelled textareas (`who`, `what`, `how`, `why`) with the localized question text and a short localized helper/placeholder based on the example in §2.
- Button **Generate words**: expands all four branches with the LLM (one LLM call per branch, run in parallel). Branches with an empty answer are skipped.
- Each branch also gets its own **↻ regenerate / + more words** action (available from the graph too, see 4.6).
- Generation **appends** new words and dedupes them against existing ones in that branch (case- and accent-insensitive). It never wipes words the user added or edited.
- Target: 8–12 words per branch per call.

### 4.6 Step 2: Node-and-branch mind map (Cytoscape.js)

A real graph, not a tag cloud:

- **Root node:** the session title (or "Project"/"Projet"), in the center.
- **4 branch nodes:** Who/What/How/Why (localized labels), each with a distinct color. Use the same 4 colors everywhere in the app (graph, acronym letter highlighting, legend).
  - `who` indigo `#6366f1`, `what` emerald `#10b981`, `how` amber `#f59e0b`, `why` rose `#f43f5e`
- **Word nodes:** connected to their branch node, or to their parent word if they came from expanding a word. They take the branch color. **Selected** words are filled; **unselected** words are faded/outlined (unselected words are excluded from acronym generation).
- **Layout:** Cytoscape's built-in `cose` layout (or `concentric` with the root in the center). Re-run the layout when nodes are added, animating and keeping existing positions stable where possible. Nodes are draggable.
- **Interactions:**
  - **Click a word:** toggle selected/unselected (persisted).
  - **Click a word's menu** (use a small floating action panel positioned next to the tapped node; no extra Cytoscape extensions): **Rename**, **Delete** (also deletes its child words), **Expand** (asks the LLM for 6–8 words related to that word, in the context of its branch and the project answers, added as child nodes).
  - **Click a branch node:** floating panel with **More words** (LLM), **Add word…** (manual input), **Select all / Deselect all** in that branch.
  - Toolbar above the graph: **Fit**, **Zoom +/−**, **Re-layout**, **Select all**, a counter "N words selected", and a color legend.
- Graph height ~560 px on desktop, ~420 px on mobile.
- Serve Cytoscape from `node_modules` with a static mount, e.g. `app.use('/vendor/cytoscape', express.static(path.join(__dirname, 'node_modules/cytoscape/dist')))`, then load `/vendor/cytoscape/cytoscape.min.js`. No CDN.

### 4.7 Step 3: Acronyms

**Settings (above the button):**
- Min length (default 3) and max length (default 6), range 2–8.
- Toggle **Real words only** (default off). When on, only show acronyms that are dictionary words in the session language.
- Toggle **Allow 2-letter chunks** (default off). When on, a word may contribute its first two letters (e.g. **Dr**one → "DR").

**Button: Generate acronyms.** It runs the pipeline in §6.3 and **appends** the results to the session's acronym list, deduped by letters + word sequence.

**Result cards**, each showing:
- The acronym in large type (e.g. `SERA`).
- The expansion: each word with its contributing letter(s) bold and colored by branch (e.g. **S**ecours · **E**scouade · **R**econnaissance · **A**érien).
- Badges: **Real word** / **Invented**, and the number of branches covered (e.g. "3/4 branches").
- The LLM score (0–100), a one-line **rationale**, and a short **tagline** in the session language.
- Actions: **★ Favorite** (toggle), **Delete**, **Copy** (copies "SERA — Secours Escouade Reconnaissance Aérien").
- **Hovering a card highlights its words in the graph.**

**List controls:** sort by score / length / newest; filter All / Favorites / Real words; a **Clear non-favorites** action (with a confirmation).

---

## 5. Data model

Create `models/BrainstormSession.js`. Use the explicit collection name **`brainstorm_sessions`** so it can never clash with a future `express-session` store.

```js
// Sketch — refine as needed, keep field names
const WordSchema = new Schema({
  branch:   { type: String, enum: ['who', 'what', 'how', 'why'], required: true },
  text:     { type: String, required: true, trim: true, maxlength: 60 },
  selected: { type: Boolean, default: true },
  source:   { type: String, enum: ['llm', 'user'], default: 'llm' },
  parentId: { type: Schema.Types.ObjectId, default: null }, // another word's _id, for expanded child words
}, { timestamps: true });

const AcronymPartSchema = new Schema({
  wordId: { type: Schema.Types.ObjectId, required: true },
  text:   String,   // snapshot of the word text at generation time
  branch: String,
  letters: String,  // the letter(s) this word contributes, e.g. "S" or "DR"
}, { _id: false });

const AcronymSchema = new Schema({
  letters:    { type: String, required: true }, // normalized uppercase, e.g. "SERA"
  parts:      [AcronymPartSchema],
  isRealWord: { type: Boolean, default: false },
  branchCoverage: { type: Number, default: 0 }, // distinct branches used, 1–4
  engineScore: Number,                          // deterministic score from code
  score:      Number,                           // LLM score 0–100 (null if LLM unavailable)
  rationale:  String,
  tagline:    String,
  source:     { type: String, enum: ['engine', 'llm'], required: true },
  favorite:   { type: Boolean, default: false },
}, { timestamps: true });

const BrainstormSessionSchema = new Schema({
  title:    { type: String, default: '', trim: true, maxlength: 120 },
  language: { type: String, enum: ['fr', 'en'], default: 'fr' },
  model:    { type: String, default: '' },
  answers:  { who: String, what: String, how: String, why: String },
  words:    [WordSchema],
  acronyms: [AcronymSchema],
}, { timestamps: true, collection: 'brainstorm_sessions' });
```

Limits: max 400 words and 500 acronyms per session. Return `422` with a clear error code if either limit would be exceeded.

---

## 6. Backend

### 6.1 Folder structure (new code)

```
routes/api.js                 // JSON API, mounted at /api (add to facades in server.js)
models/BrainstormSession.js
services/llm/index.js         // provider-agnostic facade: listModels(), chatJSON(), warmup()
services/llm/ollama.js        // Ollama implementation
services/llm/prompts.js       // all prompt builders, fr + en
services/acronym/normalize.js // accent stripping, letter extraction
services/acronym/dictionary.js// lazy-loaded, cached word Sets per language
services/acronym/engine.js    // deterministic candidate generation + scoring
views/app/index.ejs           // the single-page tool
public/js/app.js              // client logic (vanilla JS, ES modules OK)
public/js/i18n.js             // fr/en UI strings
public/js/graph.js            // Cytoscape wrapper
test/engine.test.js           // node:test unit tests
```

Add `@source "../public/js";` to `src/input.css` so Tailwind picks up classes used in client JS.

Add `.env` keys (and document them in a `.env.example` without secrets):

```
LLM_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=huihui_ai/gemma-4-abliterated:12b
LLM_TIMEOUT_MS=180000
```

### 6.2 LLM layer

- **Provider-agnostic interface** in `services/llm/index.js`:
  - `listModels() → [{ name, size }]`
  - `chatJSON({ model, system, user, temperature }) → parsed object`
  - `warmup(model)`
  
  It picks the implementation from `LLM_PROVIDER`. Implement **only Ollama** now, but keep the interface clean so a cloud provider (e.g. Claude) can be added later as `services/llm/<provider>.js` without touching routes or prompts.
- **Ollama implementation:** use the built-in `fetch` (no SDK) against `POST /api/chat` with `stream: false`, `format: "json"`, `think: false`, `keep_alive: "30m"`, and `options: { temperature }` (0.8 for word generation, 0.3 for ranking). Use `AbortController` with `LLM_TIMEOUT_MS`.
- **Robust JSON:** parse `message.content`. If parsing fails, try extracting the first `{…}` block. If that fails, retry once with a stricter "Return only valid JSON" reminder. If that still fails, throw an `LLMError('invalid_json')`.
- **Validate every LLM output in code.** Trim, drop empty or >60-char items, dedupe case/accent-insensitively, and drop items identical to existing words. Never trust the LLM for letters or word ids (see 6.3).
- **Warm-up:** `POST /api/llm/warmup { model }` sends a tiny request so the model loads. The client calls it on page load and whenever the model dropdown changes, and shows "Loading model…" until it resolves.

### 6.3 Prompts and the acronym pipeline

All prompts live in `services/llm/prompts.js`, with the **system prompt written in the session language**. Each prompt gets the full project context (all four answers), not only the branch being expanded, so words stay on-topic.

**A. Branch word expansion.** Input: branch key, its question, its answer, the other answers, and existing words in that branch. Ask for 8–12 **single words or very short noun phrases (≤ 2 words)** in the session language that are synonyms, near-synonyms, or strongly related concepts suitable for a project name. The list should mix obvious and less obvious options, include no articles, contain no duplicates of existing words, and use capitalized nouns. Output `{"words": ["...", ...]}`.

**B. Word expansion (child words).** Same idea, seeded by one word: 6–8 words related to that word, within the branch's meaning and the project context. Output `{"words": [...]}`.

**C. Acronym pipeline** (`POST /api/sessions/:id/acronyms/generate`):

1. **Collect** the selected words. If there are fewer than `minLength`, return `422 not_enough_words`.
2. **Normalize** (`normalize.js`): NFD, strip diacritics, uppercase, keep A–Z. The contributed letter is the first letter of the word, or of the first word for a 2-word phrase ("Flux vidéo" → F). With chunks enabled, the first two letters are also possible ("DR").
3. **Engine: dictionary pass** (`engine.js`, deterministic, no LLM):
   - Load the session-language dictionary. Normalize every entry, keep entries within the length range, and dedupe. Cache the result per `(language, minLen, maxLen)`.
   - For each dictionary word, check whether its letters can be **covered left-to-right** by **distinct** selected words (a word can be used at most once per acronym), using single letters or, if enabled, 2-letter chunks. Use a backtracking search that **prefers words from branches not yet used** (to maximize branch coverage), and keep the best assignment found.
   - Pre-filter fast: skip a dictionary word immediately if the multiset of its letters can't be supplied by the initials pool.
   - `engineScore` = branch coverage (major weight) + length preference (4–6 letters best) + a pronounceability heuristic (vowel/consonant alternation, no 3+ consonant clusters).
   - Keep the top **120** by `engineScore`. The pass must complete in < 2 s for 60 selected words.
4. **LLM creative pass** (runs if the LLM is available): send the selected words **with short ids** (`w1`, `w2`, …) grouped by branch. Ask for 15–20 memorable, pronounceable acronyms (real or invented words), each as an **ordered list of word ids**. Output `{"acronyms": [{"ids": ["w3","w1","w7"]}, ...]}`. **The code computes the letters from the ids** and discards any entry with unknown or repeated ids or a length outside the range. Mark `isRealWord` by dictionary lookup. If "Real words only" is on, drop invented ones. `source: 'llm'`.
5. **LLM ranking pass:** send the merged candidates (engine + creative, deduped, capped at 80, in batches of 40 if needed) with their expansions and the project context. Ask for each one: `{"letters", "keep": bool, "score": 0-100, "rationale": "≤ 20 words", "tagline": "≤ 12 words"}` in the session language. Criteria: memorability, pronounceability, meaning relevant to the project, and professional tone. **Discard candidates flagged `keep: false`** (this also filters out vulgar or offensive words and meaningless dictionary noise). Match results back to candidates by `letters` only; ignore anything else the LLM invents.
6. If the LLM is unavailable, skip steps 4–5, return engine candidates with `score: null`, and set a `llmSkipped: true` flag so the UI can say "Ranked without LLM."
7. Append to the session (dedupe by `letters` + word id sequence), save, and return the new acronyms.

### 6.4 API

All responses are JSON. Errors use `{ error: '<code>', message: '<human text>' }` with the right status code (400 validation, 404 not found, 422 business rule, 502 LLM failure, 503 DB/LLM unavailable, 504 LLM timeout). Validate ObjectIds (return 404 for invalid ones, not 500).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ db: bool, llm: bool, provider, defaultModel }` |
| GET | `/api/models` | List models from the provider |
| POST | `/api/llm/warmup` | `{ model }` → loads the model |
| GET | `/api/sessions` | List `{ _id, title, language, updatedAt }`, newest first |
| POST | `/api/sessions` | Create (optional `{ language, model }`) |
| GET | `/api/sessions/:id` | Full session |
| PATCH | `/api/sessions/:id` | Update `title`, `language`, `model`, `answers.*` |
| DELETE | `/api/sessions/:id` | Delete |
| POST | `/api/sessions/:id/expand` | `{ branches?: [...] }` → LLM words for those branches (default: all with answers) |
| POST | `/api/sessions/:id/words` | `{ branch, text, parentId? }` → manual word |
| PATCH | `/api/sessions/:id/words/:wordId` | `{ text?, selected? }` |
| POST | `/api/sessions/:id/words/bulk-select` | `{ branch?, selected }` |
| DELETE | `/api/sessions/:id/words/:wordId` | Delete the word **and its descendants** |
| POST | `/api/sessions/:id/words/:wordId/expand` | LLM child words |
| POST | `/api/sessions/:id/acronyms/generate` | `{ minLength, maxLength, realWordsOnly, allowChunks }` |
| PATCH | `/api/sessions/:id/acronyms/:acronymId` | `{ favorite }` |
| DELETE | `/api/sessions/:id/acronyms/:acronymId` | Delete one |
| POST | `/api/sessions/:id/acronyms/clear` | Delete all non-favorites |

Register the API router in the `facades` array (e.g. `{ name: 'API', mount: '/api', router: require('./routes/api') }`) with a `router.routes` list so it appears in the startup route map. Make sure the 404 handler returns JSON for `/api/*` instead of rendering the HTML 404 page, and add a JSON error handler for `/api`.

---

## 7. Frontend

- **Vanilla JS** in `public/js/*.js` (ES modules via `<script type="module">`). No build step.
- **Styling:** Tailwind utility classes only (plus minimal inline styles where Cytoscape needs them). Clean, modern look consistent with the existing slate palette. Use rounded cards and clear step headings ("1 · Describe", "2 · Explore", "3 · Acronyms").
- **State:** keep one `state` object (current session, health, busy flags). Re-render the relevant parts after every API call. Avoid full re-renders of the graph: add, update, or remove Cytoscape elements incrementally.
- **Loading states:** every LLM action disables its button and shows a spinner with a localized message. When the model is cold, show "Loading the model — the first request can take up to a minute."
- **Errors:** show toast notifications (localized) for API errors. Never fail silently.
- **Escaping:** insert user and LLM text with `textContent`, never with `innerHTML` built from untrusted strings.
- **Accessibility:** labels on all inputs, visible focus states, and buttons as real `<button>` elements. The acronym list and word actions must be usable without the graph (the graph is an enhancement; also provide a collapsible "Word list" view under the graph showing each branch's words as toggleable chips).
- **Responsive:** usable at 375 px wide with no horizontal page scroll.

---

## 8. Site cleanup

- `views/partials/head.ejs`: the nav links become **About**, **App**. Remove the **Log in** link, since sessions don't use accounts.
- Remove the placeholder routes and views `/app/login`, `/app/acronyms`, `/app/collections` (`views/app/login.ejs`, `acronyms.ejs`, `collections.ejs`) and update `router.routes` accordingly.
- Landing page (`views/public/index.ejs`): change the tagline from "Turn phrases into memorable acronyms — and acronyms into phrases." to something like "Describe your project in four answers. Get a mind map of words and a shortlist of acronyms." The main CTA points to `/app`.
- `views/public/about.ejs`: a short explanation of the four questions → mind map → acronyms flow, and a note that it runs on a local LLM via Ollama.

---

## 9. Tests

- Add `"test": "node --test"` to `package.json` scripts.
- `test/engine.test.js` (node:test + node:assert) covers:
  - normalization (`"Équipe"` → `"EQUIPE"`, initial `E`; `"Flux vidéo"` → initial `F`)
  - coverage search: a word can't be reused; left-to-right order is respected; 2-letter chunks only when enabled
  - branch-coverage preference: given a choice, the assignment covering more branches wins
  - the length range is respected
  - the LLM-id validation helper rejects unknown and duplicate ids
- Use a tiny injected dictionary in tests. Don't load the full word lists in unit tests.
- All tests must pass.

---

## 10. Acceptance checklist (verify each before reporting done)

Run these yourself against the running dev server (`http://localhost:3004`) using `curl` and the unit tests:

1. `GET /api/health` reports `db: true` and `llm: true` (Ollama running).
2. Create a session, set `language: 'fr'`, and fill in the four answers from §2 via PATCH. `GET` returns them.
3. `POST /expand` returns 8–12 French words for each of the 4 branches. A second call appends without duplicates.
4. Add a manual word, rename it, deselect it, expand a word into children, delete a parent, and confirm its children are gone.
5. `POST /acronyms/generate` returns acronyms. For **every** acronym, the concatenated `parts[].letters` equals `letters`, each `wordId` exists in the session and is selected, and no `wordId` repeats.
6. "Real words only" returns only dictionary words. The length range is respected.
7. Stop Ollama, or point `OLLAMA_URL` to a dead port temporarily: `/api/health` shows `llm: false`, and acronym generation still works with `llmSkipped: true`. Restore the setting afterwards.
8. Switch the session to `en` and expand: the words come back in English, and UI labels switch to English.
9. `npm test` passes.
10. `GET /app` renders. `GET /vendor/cytoscape/cytoscape.min.js` returns 200. `/app/login`, `/app/acronyms`, and `/app/collections` now return 404.
11. `npm run dev` and `npm run tw` are both confirmed running (restart if needed).
12. Journal updated with entries ≤ 150 characters each.

---

## 11. Final report

When done, report briefly:
- what was built (files created/changed)
- the checklist results, stating plainly anything that failed or was skipped
- any decision you made that this document didn't specify
- suggested next steps (e.g. adding a cloud provider, exporting a shortlist, per-branch weighting)
