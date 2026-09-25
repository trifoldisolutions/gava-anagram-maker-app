# UI Revamp: Build Prompt

You are revamping the UI of **gava**, an acronym brainstorming tool, at `F:\trifoldi\projects\project_acronym_maker`. The MVP works; this job is **presentation only**. The app must do everything it does today, with a new layout and visual language.

Read `AGENTS.md` first and follow it. It covers keeping `npm run dev` and `npm run tw` running, the directory restriction, and journal entries of 150 characters or fewer.

---

## 1. What exists today (read these before touching anything)

| File | Role |
|---|---|
| `views/app/index.ejs` | The tool page: sessions sidebar, top bar (title, language, model), banners, empty state, 3 stacked step cards, a node popover (`#panel`), toasts |
| `public/js/app.js` | Vanilla JS single-page client (~1100 lines). Builds much of the DOM with `h(tag, attrs, children)`, with Tailwind classes inline |
| `public/js/graph.js` | Cytoscape wrapper: a root node → 4 branch nodes (`who`/`what`/`how`/`why`) → word nodes (words can have child words) |
| `public/js/i18n.js` | `BRANCHES`, `COLORS`, and all UI strings in **fr** and **en** (same keys) |
| `views/partials/head.ejs` / `foot.ejs` | Shared shell: public header nav and footer |
| `src/input.css` | Tailwind v4 entry (`@import "tailwindcss"` + `@source` lines) |
| `routes/app.js` | Renders `app/index` with `wide: true` |

The stack is Express 5, EJS, Tailwind CSS v4 (CLI), and Cytoscape (served from `/vendor/cytoscape`). There's no frontend framework, and you won't add one.

**Out of scope:** `routes/api.js`, `services/**`, `models/**`, `test/**`, and any API or data behavior. The public pages (`views/public/*`) only pick up the new font, name and colors through the shared partials; don't redesign them.

---

## 2. Hard rules (non-negotiable)

1. **Corner radius:** an element that isn't fully rounded never goes above `rounded-md`. `rounded-full` is allowed. Enforce this in the theme (see §3) so `rounded-lg`/`xl`/`2xl`/`3xl` don't exist.
2. **Buttons are either enabled or disabled, nothing in between.**
   - Enabled: `cursor: pointer`.
   - Disabled: `cursor: not-allowed` with a visibly disabled look (reduced opacity, no hover effect).
   - A loading or busy button **is disabled** (spinner plus the `disabled` attribute). No `pointer-events-none` tricks and no clickable elements that look disabled.
   - Handle this globally in CSS (§3) so each button doesn't have to.
3. **Font:** Be Vietnam Pro, everywhere, including Cytoscape labels.
4. **Icons:** Boxicons through Iconify, referenced by the Iconify name, e.g. `<iconify-icon icon="boxicons:heart-filled"></iconify-icon>`.
5. **Tone:** minimalist, in both visuals and copy. Short labels, no filler text, no decorative clutter.
6. **Light mode only.** Don't add dark mode styles.
7. **Mobile is a real target.** Build every piece responsive as you go, not as a final pass.
8. **App name:** "gava" is provisional. Define it **once** and read it from there everywhere (§3.4). Never hardcode "gava" or the old "Acronym Maker" in templates or JS strings.
9. **No new npm dependencies.** Iconify loads through a CDN script tag.
10. **Keep every existing DOM `id`** that `app.js` queries, unless you also update `app.js` in the same change. Run `grep -n "\$('#" public/js/app.js` for the full list.

---

## 3. Foundations

### 3.1 Theme (`src/input.css`)

```css
@import "tailwindcss";

@source "../views";
@source "../dev_resources";
@source "../public/js";

@theme {
  --font-sans: "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif;

  /* Radius cap: wipe the scale, redefine up to md only */
  --radius-*: initial;
  --radius-xs: 0.125rem;
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;

  /* Brand */
  --color-cerise-50: #fdf2f8;
  --color-cerise-100: #fce7f4;
  --color-cerise-200: #fcceea;
  --color-cerise-300: #faa7d7;
  --color-cerise-400: #f670ba;
  --color-cerise-500: #ed2f93;
  --color-cerise-600: #de247d;
  --color-cerise-700: #c11562;
  --color-cerise-800: #9f1551;
  --color-cerise-900: #851646;
  --color-cerise-950: #510626;
}

@layer base {
  button:not(:disabled), [role="button"]:not([aria-disabled="true"]), summary { cursor: pointer; }
  button:disabled, [aria-disabled="true"] { cursor: not-allowed; opacity: .45; }
}
```

After changing the theme, confirm `rounded-lg` generates **no** CSS (search `public/output.css`). If Tailwind still emits it, report that rather than silently switching approaches.

### 3.2 Color usage

| Role | Token |
|---|---|
| Primary button fill | `cerise-600`, hover `cerise-700` |
| Brand text and links on white | `cerise-700` (`cerise-600` only just meets contrast) |
| Selected and active tints | `cerise-50` / `cerise-100` backgrounds |
| Focus outline | `focus-visible:outline-2 outline-cerise-500 outline-offset-2` (use this everywhere, consistently) |
| Neutrals | `zinc-*` only. Replace all `slate-*` |
| Page and canvas background | `zinc-50` |
| Surfaces (panel, sidebar, popovers) | `white`, border `zinc-200` |
| Body text / secondary / muted | `zinc-900` / `zinc-600` / `zinc-400` |
| Error / warning / info / success | `red` / `amber` / `sky` / `emerald`. **Don't use `rose` or `pink`**; they look too close to the brand |

Remove every `indigo-*` and `rose-*` class from the app page and `app.js`.

### 3.3 Graph branch colors (`public/js/i18n.js` → `COLORS`)

```js
who: '#6366f1', // indigo
what: '#10b981', // emerald
how: '#f59e0b', // amber
why: '#0ea5e9', // sky (was rose; rose looked too close to cerise)
```

This is a data palette. Use it only for graph nodes, legend dots and word chips.

### 3.4 Name and head

- Create one source of truth, e.g. `app.locals.appName = 'gava'` in `server.js` (or a small `config/brand.js` it requires). Templates use `<%= appName %>`. If client JS needs the name, pass it through `<body data-app-name="<%= appName %>">`.
- Page titles: `<%= appName %>`, or `Page · <%= appName %>`.
- The wordmark is lowercase text in Be Vietnam Pro, weight 700 with tight tracking. There's no logo yet; don't invent one.
- In `head.ejs`, add the Google Fonts link for Be Vietnam Pro (400, 500, 600, 700, `display=swap`) with `preconnect`, and the Iconify web component:
  `<script src="https://cdn.jsdelivr.net/npm/iconify-icon@2/dist/iconify-icon.min.js"></script>`
- The app page needs a **bare full-screen shell**: no public header or footer, `h-dvh overflow-hidden`. Add a local such as `shell: 'app'` in `routes/app.js` that `head.ejs`/`foot.ejs` check to skip the header and footer. Public pages keep their header and footer.

### 3.5 Icons

Before using any icon name, **verify it exists**:
`https://api.iconify.design/boxicons.json?icons=menu,plus,x,cog` (a missing name comes back under `"not_found"`). If the `boxicons` prefix itself doesn't resolve, stop and ask. Don't swap in another set.

Every icon-only button needs `aria-label` and `title`. Default icon size is 20px (`width="20"` / `font-size`); the minimum tap target is 40×40 on desktop and 44×44 on touch.

---

## 4. Layout

The **canvas is the product.** The Cytoscape graph fills the whole viewport behind everything else, and the UI floats on top of it.

```
Desktop (≥ lg)
┌────────┬──────────────────────────────────────────────────────────┐
│Sidebar │  ┌──────────────┐                                        │
│ gava   │  │ Workflow     │         CANVAS (full bleed)            │
│ + New  │  │ panel        │         pan · zoom · scroll            │
│Sessions│  │ (floating)   │                                        │
│  ...   │  │              │                        ┌──┐ legend     │
│        │  └──────────────┘                        │⊕⊖│ controls   │
└────────┴──────────────────────────────────────────────────────────┘

Mobile (< lg)
┌──────────────────────────┐
│ ☰  gava                  │  ← floating top bar (transparent)
│                          │
│      CANVAS (full)       │
│                    ┌──┐  │
│                    │⊕⊖│  │
│ ╭──────────────────────╮ │
│ │ ═══ bottom sheet ═══ │ │  ← workflow panel as a draggable sheet
│ ╰──────────────────────╯ │
└──────────────────────────┘
```

### 4.1 Sidebar (sessions now, account and navigation later)

- **Desktop, expanded:** `w-64`, white, right border `zinc-200`, full height. Top row: wordmark plus a collapse icon button. Below it: a secondary "new session" icon button (the primary CTA lives in the workflow panel), then the scrollable session list (`#session-list`). Keep rename and delete per session, with the actions in a small overflow menu or shown on hover and focus.
- **Desktop, collapsed:** the sidebar disappears entirely and leaves **a single floating icon button** (`boxicons:menu` or similar) at the top-left of the canvas, which re-expands it. Save the collapsed or expanded choice in `localStorage` (wrapped in try/catch). Default: expanded at ≥ xl, collapsed at lg.
- **Mobile:** an off-canvas drawer opened by the same icon button in the floating top bar, with a backdrop (`#drawer-backdrop`), closed by Esc, backdrop tap or picking a session. Keep the existing drawer functions in `app.js` working.
- The sidebar pushes the canvas area on desktop, but the canvas still fills everything to the sidebar's right.
- Leave room at the bottom for future account items. **Don't add placeholder account UI.**

### 4.2 Workflow panel (new; the main interaction surface)

It holds everything that used to be the top bar and the 3 step cards. **Give it a new id (`#workflow`)**. Don't reuse `#panel`, which remains the node popover (§4.5).

**Desktop:**
- Floats over the canvas: `absolute` (or `fixed`), `top-4 bottom-4`, `left-4` from the sidebar's edge (or from the collapsed menu button's column).
- `w-[360px]`, white at ~95% opacity with `backdrop-blur`, border `zinc-200`, `rounded-md`, soft shadow.
- It scrolls internally (`overflow-y-auto`); the page itself never scrolls.
- **Minimize control:** the panel can shrink to a slim header strip (session title plus an expand icon button) so the user can explore a large graph. Save the state in `localStorage`.

**Panel structure, top to bottom:**
1. **Header:** the editable session title (`#title`), the save status (`#save-status`) and a settings icon button that opens a small popover with Language (`#language`) and Model (`#model`).
2. **Step navigation:** a compact 3-item segmented control, *Describe · Explore · Acronyms*, showing one step's content at a time. Advance automatically where it's obvious: after words are generated, switch to Explore; after acronyms are generated, stay on Acronyms. The user can always click any step.
3. **Step content:**
   - **Describe:** the 4 questions (`#questions`), stacked in one column, and the "Generate words" primary button (`#generate-words`, cerise, full width). Keep `#words-status`.
   - **Explore:** `#select-all`, `#selected-count`, and the word list (`#word-list`, one column, grouped by branch with a colored dot). Hint text is one short line.
   - **Acronyms:** the form (`#acronym-form` with all its current fields; lay them out as a tidy 2-column grid inside 360px), `#per-branch-hint`, `#acronym-status`, then sort (`#sort`), filters (`#filters`), `#clear-acronyms`, and results (`#acronym-list`, one column of compact cards) plus `#acronym-empty`. Hovering or focusing an acronym card still highlights its words on the graph (existing `graph.highlight`).
4. **Banners** (`#banner-db`, `#banner-llm`, `#banner-warmup`, `#banner-lang`) sit at the top of the panel body, restyled as quiet inline notices: small icon, one line where possible, `rounded-md`, tinted background.

**No session selected:** the panel shows a short intro (one line) and the **primary CTA "New session"** (`#empty-new` / `#new-session`, full-width cerise). The panel is always present; only its content changes.

### 4.3 Canvas

- `#graph` fills the viewport area to the right of the sidebar (full width on mobile). Background `zinc-50` with a very faint dot grid (a CSS `radial-gradient` on the wrapper, `zinc-200` dots, ~24px spacing).
- **Controls:** a vertical icon toolbar at bottom-right: zoom in, zoom out, fit, relayout (the existing `[data-graph]` buttons, now icon-only with `aria-label` and `title`). On mobile it sits above the sheet's peek height.
- **Legend** (`#legend`): 4 colored dots with branch names, a small translucent pill at bottom-right next to or above the controls. Hide it on mobile below `sm`; the Explore step already shows the branch dots.
- **Fit must respect the panel.** Replace the plain `cy.fit` with a `fitToVisible()` in `graph.js`: take the visible rectangle (the canvas minus the workflow panel's width and inset on desktop, minus the sheet's current height on mobile), compute the zoom that fits the elements' bounding box inside it with padding, and pan so the box centers in that rectangle. Use it for the first layout, the Fit button and relayout.
- Observe the canvas container with a `ResizeObserver` and call `cy.resize()` (and refit only if the user hasn't panned or zoomed yet) when the sidebar collapses, the panel minimizes or the viewport changes.

### 4.4 Empty canvas states (bilingual copy in `i18n.js`)

Center these in the visible rectangle (not the full viewport), over a **ghost graph**: a static inline SVG of a root circle, 4 branch circles and a few small word dots with thin lines, all `zinc-200`/`zinc-300`, low opacity, `aria-hidden="true"`.

The copy **shows what will appear on the canvas**; it isn't a bare instruction.

| State | EN | FR |
|---|---|---|
| No session | **Your ideas, mapped.** / Answer four questions. Your words branch out here, and the acronyms hiding in them follow. | **Vos idées, cartographiées.** / Répondez à quatre questions. Vos mots se déploient ici, et les acronymes qu'ils cachent suivent. |
| Session, no words yet | **Your map starts here.** / Generate words to watch them branch out. | **Votre carte commence ici.** / Générez des mots pour les voir se déployer. |

Title: `text-lg font-semibold zinc-800`. Body: `text-sm zinc-500`, max ~32ch. No buttons on the canvas; the CTA is in the panel. On desktop, you may add a subtle arrow or cue pointing left toward the panel.

Reuse or replace the existing `emptyTitle`, `emptyBody` and `graphEmpty` keys. Keep fr and en in sync.

### 4.5 Node popover (`#panel`, the existing word and branch action menu)

Keep its behavior (tap or right-click or long-press → menu → edit, expand, add child, delete…). Restyle it: white, border `zinc-200`, `rounded-md`, shadow, `text-sm`, icon plus label rows. Keep it clamped inside the viewport. On mobile, show it as a small action sheet anchored to the bottom (above the workflow sheet) instead of beside the node.

### 4.6 Toasts

Bottom-center on mobile (above the sheet), bottom-right on desktop. White, `rounded-md`, shadow, icon plus text, with a left accent in the state color.

---

## 5. Graph restyle (`public/js/graph.js`): Obsidian-style, light mode

Reference: the **Obsidian notes graph**. Small circular nodes, thin quiet edges, labels **under** the nodes, and hovering a node lights up its neighborhood while the rest fades. Keep the structure (root → 4 branches → words → child words), the `cose` layout and every exported function's API.

| Element | Style |
|---|---|
| All nodes | `shape: ellipse`, labels **below** (`text-valign: bottom`, `text-margin-y: 6`), font Be Vietnam Pro, `min-zoomed-font-size: 7` so labels drop out when zoomed far out |
| Root | **A filled `cerise-600` circle, ~28px, with no text inside** (the project title no longer goes in the node). Subtle `cerise-200` halo (`border-width: 6`, `border-opacity: .5`). No label; the title lives in the panel header |
| Branch | Circle ~18px in its branch color. Label: 12px, weight 600, `zinc-700` |
| Word, selected | Circle in its branch color; size grows slightly with degree (e.g. `10 + min(degree, 6) * 1.5` px). Label 11px, `zinc-600` |
| Word, unselected (`.off`) | White fill, 1.5px border in the branch color at ~50% opacity, label `zinc-400` |
| Edges | 1px, `zinc-300`, `curve-style: straight` (or `haystack`), opacity .9 |
| Hover (new) | On `mouseover` of any node: the node plus its closed neighborhood stay at full opacity and edges within it take the branch color; everything else fades to ~.12. Clear on `mouseout`. 150ms transitions |
| `.active` (popover open) | 2px `cerise-600` ring (`border-width` plus `border-color`), `z-index` above the others |
| `.hl` (acronym hover) | Same ring as `.active`; the existing `.dim` logic stays |

- Wait for `document.fonts.ready` before the first layout so label widths are measured with Be Vietnam Pro.
- Keep tap, right-click and long-press behavior exactly as it is now.
- Update `LAYOUT` spacing if the smaller nodes make the graph feel cramped or sparse. Keep `cose`, and don't add layout extensions.

---

## 6. Mobile (< lg)

- **Top bar:** floating and transparent over the canvas, with a menu icon button (opens the sidebar drawer) and the wordmark. It respects `env(safe-area-inset-top)`.
- **Workflow panel → bottom sheet**, with the same `#workflow` element restyled by breakpoint:
  - Snap points: **peek** (~96px: drag handle, session title and the current step's primary action), **half** (~50dvh) and **full** (~90dvh).
  - Drag with pointer events on the handle; tapping the handle cycles peek → half → full. It snaps to the nearest point on release. Esc or the canvas behind doesn't close it; it goes back to peek.
  - `rounded-t-md`, white, top shadow, content scrolls internally, `padding-bottom: env(safe-area-inset-bottom)`.
  - Tell the graph when the sheet height changes so `fitToVisible()` uses the right rectangle.
- Use `dvh` units, not `vh`. Touch targets are ≥ 44px. No horizontal page scroll at 320px wide.
- Pinch-zoom and pan work on the canvas. The sheet and top bar must not steal gestures from it.

---

## 7. Implementation order

Work in this order. After each phase, confirm `/app` still loads (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3004/app` → 200), that there are no console errors, and that `npm run dev` and `npm run tw` are still alive.

1. **Foundations:** theme, font, Iconify, `appName`, bare shell for `/app`, global button CSS.
2. **Layout skeleton:** full-bleed canvas, sidebar (expanded, collapsed, drawer), `#workflow` panel shell with minimize.
3. **Move content into the panel:** header, settings popover, step navigation, the 3 steps, banners. Restyle the markup generated in `app.js` (word chips, acronym cards, session rows, popover rows, toasts) to the new tokens.
4. **Graph restyle** plus `fitToVisible()` plus the resize handling.
5. **Empty states** with the ghost graph and bilingual copy.
6. **Mobile:** top bar, bottom sheet and its snap points, popover as an action sheet, legend and controls placement.
7. **QA pass** (§8).

Add journal entries in `dev_resources/journal.md` as you go: **one entry per notable change, each 150 characters or fewer.**

---

## 8. Acceptance checklist

Run these and fix anything that fails:

- [ ] `grep -rnE "rounded-(lg|xl|2xl|3xl)" views public/js` → no matches.
- [ ] `grep -rnE "(slate|indigo|rose)-[0-9]" views/app views/partials public/js` → no matches.
- [ ] `grep -rniE "acronym maker|>\s*gava\s*<" views public/js` → no hardcoded names (only `appName` usage).
- [ ] Every `<button>`: enabled shows a pointer cursor; disabled and busy show `not-allowed` plus the faded look. Check `#generate-words` and `#generate-acronyms` while a request is running.
- [ ] Every icon-only button has `aria-label` and `title`; keyboard focus is visible everywhere (cerise outline).
- [ ] All Iconify names resolve (none under `not_found`).
- [ ] The full flow works in **both fr and en**: create session → answer → generate words → select and deselect on the graph and in the list → popover actions (edit, expand, add child, delete) → generate acronyms → sort, filter, favorite, copy, delete, clear → rename and delete session → reload restores the session from `?s=<id>`.
- [ ] The DB-down and LLM-down banners still appear (stop Mongo or Ollama to check, or simulate).
- [ ] Hovering a node fades everything except its neighborhood; hovering an acronym card highlights its words.
- [ ] Fit centers the graph in the area **not** covered by the panel or sheet.
- [ ] Sidebar collapse and panel minimize persist across reloads; the canvas resizes correctly after each.
- [ ] Widths tested: 320, 375, 768, 1024, 1280, 1536. No horizontal scroll; the sheet snaps correctly; pinch-zoom works.
- [ ] `npm test` still passes.
- [ ] `npm run dev` and `npm run tw` are both running at the end.

---

## 9. When to stop and ask

- The `boxicons` Iconify prefix or a needed icon doesn't exist.
- A change would require touching the API, models or services.
- A requirement here conflicts with existing behavior in `app.js` that you can't keep.
- Anything would need a file outside the project directory.

Don't guess on these. Report what you found and ask.
