Set up a new Node.js project in this directory with the following:
## 0. Project Path
The project root is `F:\trifoldi\projects\project_acronym_maker` — substitute the actual project's folder name for `project_acronym_maker` (also used elsewhere in this doc, e.g. the Mongo `dbName`/URI in step 2 and the `.vbs` launcher name in step 6). Use this exact path regardless of whatever default working directory the harness/agent normally creates new files in.

- If `F:\trifoldi\projects\project_acronym_maker` already exists, use it as-is as the project root — do not create a nested subdirectory inside it, and do not create the project elsewhere.
- If it does not exist yet, create it at that exact path before doing anything else.
- Do not place any project file (dependencies, `.env`, `server.js`, etc.) in the harness's default directory if that differs from the path above.

## 1. Dependencies
Initialize npm and install:

- express
- mongoose
- ejs
- dotenv

Dev dependencies:
- nodemon
- tailwindcss
- @tailwindcss/cli
- concurrently (optional — only needed if you also want a manual "run both in one pane" script; the default folder-open behavior no longer uses it, see step 7)

## 2. Environment config
Before writing `.env`, look up this project's assigned port in `F:\trifoldi\projects\project-ports.json`. That file groups ports by category (`fire`/`mid`/`cold`) and maps each port number to `{ "name", "description" }`; find the entry whose `name` matches `project_acronym_maker` and use its port number as `PORT` below. Do not invent or hardcode a port — if no entry exists yet for this project's folder name, stop and ask, since ports are a shared registry and an unreserved one may collide with another project.

Create a `.env` file at the project root with:

```
PORT=<port looked up from project-ports.json>
MONGO_URI=mongodb://localhost:27017/project_acronym_maker
SESSION_SECRET=
NODE_ENV=development
```

## 3. package.json scripts
```
"dev": "nodemon server.js"
"tw": "tailwindcss -i ./src/input.css -o ./public/output.css --watch"
"dev:all": "concurrently -k -n TW,SERVER -c yellow,cyan \"npm run tw\" \"npm run dev\""
```
`dev:all` is kept as an optional manual convenience script (single interleaved terminal pane)
but is NOT what auto-runs on folder open — see step 7.

## 4. Basic server + three-facade structure
Create `server.js` using Express + EJS, listening on `PORT` from `.env` (default 3008).
Scaffold the app around three separate facades from day one, each as its own route module
and view folder:

- **Public** (`routes/public.js`, `views/public/`) — mounted at `/`. Landing page + related
  public pages.
- **App** (`routes/app.js`, `views/app/`) — mounted at `/app`. Index page, a combined
  login/sign-up page, and placeholder template pages for the core entities (adjust names to
  the project). Keep these as placeholder shells until real requirements are defined.
- **Admin** (`routes/admin.js`, `views/admin/`) — mounted at `/admin`. Index page placeholder.

Each route module exports the router with a `.routes` metadata array attached
(`{ method, path, label }`) documenting its own routes inline, e.g.:

```js
router.routes = [
  { method: 'GET', path: '/', label: 'Landing page' },
];
```

In `server.js`, build a `facades` array (`{ name, mount, router }`), mount them all, and on
`app.listen` print a route map as full clickable URLs
(`http://localhost:<port>/path — label`) — this reprints on every nodemon restart too, so
the full route list is always visible in the `npm run dev` terminal tab (Ctrl+click to
navigate in VS Code's integrated terminal).

Mongoose connection: pass `{ dbName: '<project-name>' }` explicitly to `mongoose.connect()`
— local Mongo URIs often omit the database name from the path, so don't rely on it being
implicit.

## 5. Git
Initialize a git repository (`git init`), create a `.gitignore` covering:
```
node_modules/
.env
*.log
npm-debug.log*
.DS_Store
Thumbs.db
public/output.css
```
Make an initial commit. No remote needed yet.

## 6. Launcher script (.vbs)
Create a `.vbs` file at the project root named project_acronym_maker.vbs that just opens VS Code
in the project folder, hidden/silently, via `cmd /c code "<path>"` with window style 0. It
does NOT try to run npm scripts itself — that's handled entirely by `.vscode/tasks.json`
(VS Code's `runOn: folderOpen`), since a `.vbs` script can only launch the editor.

## 7. .vscode/tasks.json — two separate terminal tabs, not one merged pane
Auto-run `npm run tw` and `npm run dev` as **two separate tasks**, each `isBackground: true`,
`runOn: folderOpen`, `presentation.panel: "dedicated"` — this makes each open in its own
terminal tab in VS Code's terminal panel, rather than interleaving both through
`concurrently` in a single pane:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "TW (watch)",
      "type": "shell",
      "command": "npm run tw",
      "isBackground": true,
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "dedicated", "clear": true },
      "runOptions": { "runOn": "folderOpen" }
    },
    {
      "label": "Server (nodemon)",
      "type": "shell",
      "command": "npm run dev",
      "isBackground": true,
      "problemMatcher": [],
      "presentation": { "reveal": "always", "panel": "dedicated", "clear": true },
      "runOptions": { "runOn": "folderOpen" }
    }
  ]
}
```

## 8. dev_resources/ folder
Create a `dev_resources/` folder (internal only, not linked from the public site) with:

- **journal.md** — a daily project log, newest entries at the top, with a template HTML
  comment block for the entry format (`## YYYY-MM-DD`, bullet list of what changed / why).
  Seed it with an entry for the day the project was bootstrapped.
- **tasks.ejs** — a small internal task board page (mounted at `/dev-resources/tasks` via
  `routes/tasks.js` + a `models/Task.js` Mongoose model: `title`, `description`,
  `status: todo|in-progress|done`, timestamps). Supports create, inline edit (via `<details>`,
  no client JS framework needed), and delete, all through plain HTML forms POSTing back to
  the route. Note: this needs `MONGO_URI` set to actually persist anything — call that out if
  it's still blank at scaffold time.

---