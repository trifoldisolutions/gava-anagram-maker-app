# Project Journal

<!--
Entry template:

## YYYY-MM-DD
- **HH:MM** — What changed
-->

## 2026-09-25
- **01:05** — Acronyms now use at most 1 word per branch by default (engine, LLM prompt + id check); new "Words per branch" 1–3 setting.
- **01:05** — Added length_unreachable 422 + max-length hint in step 3; 2 new engine tests (11 passing).
- **00:46** — Built /app single-page tool: 4 questions → Cytoscape mind map → ranked acronyms, saved as brainstorm sessions.
- **00:46** — Added JSON API at /api (sessions, words, expand, acronyms) with JSON 404/error handling; BrainstormSession model.
- **00:46** — LLM layer in services/llm (provider facade + Ollama, fr/en prompts, JSON retry); warm-up endpoint.
- **00:46** — Acronym engine: dictionary coverage search (fr/en word lists), branch-coverage scoring, LLM creative + rank passes.
- **00:46** — Frontend in public/js (app, graph, i18n); fr/en UI; removed Log in nav link and /app placeholder routes.
- **00:46** — Added npm test (node:test, 9 engine tests passing); .env LLM keys + .env.example; updated landing/about.

## 2026-09-24
- **13:00** — Bootstrapped Express + EJS + Mongoose + Tailwind v4; .env on port 3004 from project-ports.json.
- **13:00** — Added Public (/), App (/app), Admin (/admin) facades; route map prints on server start.
- **13:00** — Added internal task board at /dev-resources/tasks (Task model, create/edit/delete).
- **13:00** — Added .vscode/tasks.json (tw + dev on folder open), .vbs launcher, git init.
- **12:42** — Project was created

