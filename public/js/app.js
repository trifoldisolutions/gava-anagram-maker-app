// Project Acronym Maker — single-page client (vanilla JS).
import { BRANCHES, COLORS, t, setLang, getLang, errorText, applyStatic } from './i18n.js';
import { createGraph } from './graph.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  health: { db: false, llm: false, defaultModel: '' },
  models: [],
  sessions: [],
  session: null,
  modelWarm: false,
  warming: false,
  busy: new Set(), // 'words', 'branch:who', 'word:<id>', 'acronyms'
  titleAuto: false,
  langHint: false,
  sort: 'score',
  filter: 'all',
  panel: null, // { kind: 'word' | 'branch', id, mode }
};

let graph = null;

// ---------------------------------------------------------------------------
// DOM helpers (all text goes through textContent)

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const show = (el, on) => { el.hidden = !on; };

function spinner(extra = '') {
  return h('span', { class: `inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${extra}`, 'aria-hidden': 'true' });
}

function toast(message, kind = 'error') {
  const colors = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-slate-200 bg-white text-slate-700',
  };
  const el = h('div', { class: `pointer-events-auto max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${colors[kind]}`, role: kind === 'error' ? 'alert' : 'status', text: message });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

// ---------------------------------------------------------------------------
// API

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || res.statusText);
    err.code = data.error || 'generic';
    err.status = res.status;
    if (err.code === 'database_unavailable') { state.health.db = false; renderBanners(); }
    if (err.code === 'llm_unavailable') { state.health.llm = false; renderBanners(); renderBusy(); }
    throw err;
  }
  return data;
}

function fail(err) {
  toast(errorText(err));
}

// ---------------------------------------------------------------------------
// Health, models, warm-up

async function checkHealth() {
  try {
    state.health = await api('GET', '/health');
  } catch {
    state.health = { db: false, llm: false, defaultModel: '' };
  }
  renderBanners();
}

async function loadModels() {
  if (!state.health.llm) { state.models = []; renderModelSelect(); return; }
  try {
    const data = await api('GET', '/models');
    state.models = data.models;
  } catch {
    state.models = [];
  }
  renderModelSelect();
}

const currentModel = () => state.session?.model || state.health.defaultModel || '';

let warmToken = 0;
async function warmup() {
  if (!state.health.llm) return;
  const token = ++warmToken;
  state.warming = true;
  state.modelWarm = false;
  renderBanners();
  try {
    await api('POST', '/llm/warmup', { model: currentModel() });
    if (token === warmToken) state.modelWarm = true;
  } catch (err) {
    if (token === warmToken) fail(err);
  } finally {
    if (token === warmToken) { state.warming = false; renderBanners(); }
  }
}

// ---------------------------------------------------------------------------
// Sessions

function sessionIdFromUrl() {
  return new URLSearchParams(location.search).get('s');
}

function setUrl(id, replace = false) {
  const url = id ? `/app?s=${encodeURIComponent(id)}` : '/app';
  history[replace ? 'replaceState' : 'pushState']({ s: id }, '', url);
}

async function loadSessions() {
  if (!state.health.db) { state.sessions = []; renderSessions(); return; }
  try {
    state.sessions = (await api('GET', '/sessions')).sessions;
  } catch (err) {
    state.sessions = [];
    fail(err);
  }
  renderSessions();
}

async function openSession(id, { push = true } = {}) {
  await flushSave();
  try {
    const { session } = await api('GET', `/sessions/${id}`);
    const prevModel = currentModel();
    state.session = session;
    state.titleAuto = !session.title;
    state.langHint = false;
    closePanel();
    if (push) setUrl(id);
    setLang(session.language);
    renderAll({ resetGraph: true });
    closeDrawer();
    if (currentModel() !== prevModel || !state.modelWarm) warmup();
  } catch (err) {
    fail(err);
    if (err.status === 404) {
      state.sessions = state.sessions.filter((s) => s._id !== id);
      const fallback = state.sessions[0]?._id;
      if (fallback) return openSession(fallback, { push: false }).then(() => setUrl(fallback, true));
      state.session = null;
      setUrl(null, true);
      renderAll({ resetGraph: true });
    }
  }
}

async function createSession() {
  try {
    const { session } = await api('POST', '/sessions', { language: getLang(), model: currentModel() });
    state.sessions.unshift({ _id: session._id, title: session.title, language: session.language, updatedAt: session.updatedAt });
    await openSession(session._id);
    $('#title').focus();
  } catch (err) {
    fail(err);
  }
}

async function renameSession(id, title) {
  try {
    await api('PATCH', `/sessions/${id}`, { title });
    const item = state.sessions.find((s) => s._id === id);
    if (item) { item.title = title; item.updatedAt = new Date().toISOString(); }
    if (state.session?._id === id) {
      state.session.title = title;
      state.titleAuto = !title;
      $('#title').value = title;
      renderGraphLabels();
    }
    renderSessions();
  } catch (err) {
    fail(err);
  }
}

async function deleteSession(id) {
  const item = state.sessions.find((s) => s._id === id);
  if (!confirm(t('confirmDeleteSession', { title: item?.title || t('untitled') }))) return;
  try {
    await api('DELETE', `/sessions/${id}`);
    state.sessions = state.sessions.filter((s) => s._id !== id);
    if (state.session?._id === id) {
      clearTimeout(saveTimer);
      pendingPatch = null;
      state.session = null;
      if (state.sessions.length) await openSession(state.sessions[0]._id);
      else { setUrl(null); renderAll({ resetGraph: true }); }
    }
    renderSessions();
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Autosave (debounced PATCH)

let saveTimer = null;
let pendingPatch = null;
let savePromise = null;

function setSaveStatus(key) {
  $('#save-status').textContent = key ? t(key) : '';
}

function queueSave(patch) {
  if (!state.session) return;
  pendingPatch = pendingPatch || { id: state.session._id, body: {} };
  const body = pendingPatch.body;
  if (patch.answers) body.answers = { ...(body.answers || {}), ...patch.answers };
  for (const k of ['title', 'language', 'model']) if (patch[k] !== undefined) body[k] = patch[k];
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (savePromise) await savePromise;
  if (!pendingPatch) return;
  const { id, body } = pendingPatch;
  pendingPatch = null;
  savePromise = api('PATCH', `/sessions/${id}`, body)
    .then(({ session }) => {
      const item = state.sessions.find((s) => s._id === id);
      if (item) {
        item.title = session.title;
        item.language = session.language;
        item.updatedAt = session.updatedAt;
        state.sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        renderSessions();
      }
      if (!pendingPatch) setSaveStatus('saved');
    })
    .catch((err) => { setSaveStatus('saveError'); fail(err); })
    .finally(() => { savePromise = null; });
  await savePromise;
}

// ---------------------------------------------------------------------------
// Words

const words = () => state.session?.words || [];
const wordById = (id) => words().find((w) => w._id === id);
const hasAnswer = (b) => !!(state.session?.answers?.[b] || '').trim();

function llmBusyMessage(key) {
  return state.modelWarm ? t(key) : t('loadingCold');
}

async function withBusy(key, fn) {
  if (state.busy.has(key)) return;
  state.busy.add(key);
  renderBusy();
  try {
    await fn();
  } catch (err) {
    fail(err);
  } finally {
    state.busy.delete(key);
    renderBusy();
  }
}

function addWords(list) {
  if (!list.length) return;
  state.session.words.push(...list);
  renderWords();
}

async function expandBranches(branches) {
  const key = branches.length === 1 ? `branch:${branches[0]}` : 'words';
  await flushSave();
  await withBusy(key, async () => {
    const sid = state.session._id;
    const data = await api('POST', `/sessions/${sid}/expand`, branches.length === 1 ? { branches } : {});
    if (state.session?._id !== sid) return;
    state.modelWarm = true;
    addWords(data.words);
    toast(data.words.length ? t('wordsAdded', { n: data.words.length }) : t('noNewWords'), data.words.length ? 'ok' : 'info');
    for (const [b, e] of Object.entries(data.errors || {})) {
      toast(t('branchFailed', { branch: t(`b_${b}`), message: errorText({ code: e.error, message: e.message }) }));
    }
  });
}

async function expandWord(id) {
  await withBusy(`word:${id}`, async () => {
    const sid = state.session._id;
    const data = await api('POST', `/sessions/${sid}/words/${id}/expand`);
    if (state.session?._id !== sid) return;
    state.modelWarm = true;
    addWords(data.words);
    toast(data.words.length ? t('wordsAdded', { n: data.words.length }) : t('noNewWords'), data.words.length ? 'ok' : 'info');
  });
}

async function addManualWord(branch, text, parentId) {
  const value = text.trim();
  if (!value) return false;
  try {
    const { word } = await api('POST', `/sessions/${state.session._id}/words`, { branch, text: value, parentId });
    addWords([word]);
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}

async function patchWord(id, body) {
  const w = wordById(id);
  if (!w) return;
  const before = { ...w };
  Object.assign(w, body); // optimistic
  renderWords();
  try {
    const { word } = await api('PATCH', `/sessions/${state.session._id}/words/${id}`, body);
    Object.assign(w, word);
  } catch (err) {
    Object.assign(w, before);
    fail(err);
  }
  renderWords();
}

async function deleteWord(id) {
  const w = wordById(id);
  if (!w || !confirm(t('confirmDeleteWord', { word: w.text }))) return;
  try {
    const { deleted } = await api('DELETE', `/sessions/${state.session._id}/words/${id}`);
    const gone = new Set(deleted);
    state.session.words = state.session.words.filter((x) => !gone.has(x._id));
    closePanel();
    renderWords();
  } catch (err) {
    fail(err);
  }
}

async function bulkSelect(branch, selected) {
  const affected = words().filter((w) => !branch || w.branch === branch);
  const before = affected.map((w) => w.selected);
  affected.forEach((w) => { w.selected = selected; });
  renderWords();
  try {
    await api('POST', `/sessions/${state.session._id}/words/bulk-select`, branch ? { branch, selected } : { selected });
  } catch (err) {
    affected.forEach((w, i) => { w.selected = before[i]; });
    renderWords();
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Acronyms

async function generateAcronyms() {
  const minLength = Number($('#min-length').value);
  const maxLength = Number($('#max-length').value);
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 2 || maxLength > 8 || minLength > maxLength) {
    toast(t('lengthError'));
    return;
  }
  const body = {
    minLength,
    maxLength,
    realWordsOnly: $('#real-only').checked,
    allowChunks: $('#chunks').checked,
    maxPerBranch: Number($('#per-branch').value),
  };
  await withBusy('acronyms', async () => {
    const sid = state.session._id;
    const data = await api('POST', `/sessions/${sid}/acronyms/generate`, body);
    if (state.session?._id !== sid) return;
    if (!data.llmSkipped) state.modelWarm = true;
    state.session.acronyms.push(...data.acronyms);
    renderAcronyms();
    const note = $('#acronym-status');
    note.textContent = [data.acronyms.length ? t('acronymsAdded', { n: data.acronyms.length }) : t('noNewAcronyms'), data.llmSkipped ? t('rankedWithoutLlm') : '']
      .filter(Boolean).join(' ');
    show(note, true);
    if (data.llmError && state.health.llm) toast(errorText({ code: data.llmError.error, message: data.llmError.message }));
  });
}

async function toggleFavorite(a) {
  a.favorite = !a.favorite;
  renderAcronyms();
  try {
    await api('PATCH', `/sessions/${state.session._id}/acronyms/${a._id}`, { favorite: a.favorite });
  } catch (err) {
    a.favorite = !a.favorite;
    renderAcronyms();
    fail(err);
  }
}

async function deleteAcronym(a) {
  try {
    await api('DELETE', `/sessions/${state.session._id}/acronyms/${a._id}`);
    state.session.acronyms = state.session.acronyms.filter((x) => x._id !== a._id);
    graph?.clearHighlight();
    renderAcronyms();
  } catch (err) {
    fail(err);
  }
}

async function clearAcronyms() {
  if (!confirm(t('confirmClear'))) return;
  try {
    await api('POST', `/sessions/${state.session._id}/acronyms/clear`);
    state.session.acronyms = state.session.acronyms.filter((a) => a.favorite);
    renderAcronyms();
  } catch (err) {
    fail(err);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'fixed -left-[9999px]' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('copied'), 'ok');
}

// ---------------------------------------------------------------------------
// Rendering

function renderAll({ resetGraph = false } = {}) {
  applyStatic();
  renderBanners();
  renderSessions();
  const has = !!state.session;
  show($('#workspace'), has);
  show($('#session-bar'), has);
  show($('#empty-state'), !has && state.health.db);
  if (!has) return;
  $('#title').value = state.session.title;
  $('#title').placeholder = t('untitled');
  $('#language').value = state.session.language;
  renderModelSelect();
  renderQuestions();
  renderLegend();
  if (resetGraph) initGraph();
  renderGraphLabels();
  renderWords();
  renderAcronyms();
  renderBusy();
  setSaveStatus('');
}

function renderBanners() {
  show($('#banner-db'), !state.health.db);
  show($('#banner-llm'), state.health.db !== undefined && !state.health.llm);
  show($('#banner-warmup'), state.health.llm && state.warming);
  show($('#banner-lang'), !!state.session && state.langHint);
  $('#new-session').disabled = !state.health.db;
}

function renderSessions() {
  const list = $('#session-list');
  list.replaceChildren();
  if (!state.sessions.length) {
    list.append(h('li', { class: 'px-2 py-3 text-sm text-slate-400', text: t('noSessions') }));
    return;
  }
  const fmt = new Intl.DateTimeFormat(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  for (const s of state.sessions) {
    const active = state.session?._id === s._id;
    const li = h('li', { class: `group rounded-lg ${active ? 'bg-slate-100' : 'hover:bg-slate-50'}` });
    const open = h('button', {
      type: 'button',
      class: 'block w-full min-w-0 rounded-lg px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
      'aria-current': active ? 'true' : undefined,
      onclick: () => { if (!active) openSession(s._id); else closeDrawer(); },
    }, [
      h('span', { class: `block truncate text-sm ${active ? 'font-semibold' : 'font-medium'} ${s.title ? '' : 'italic text-slate-500'}`, text: s.title || t('untitled') }),
      h('span', { class: 'block text-xs text-slate-400', text: fmt.format(new Date(s.updatedAt)) }),
    ]);
    const actions = h('div', { class: 'flex gap-1 px-2 pb-2' }, [
      h('button', {
        type: 'button',
        class: 'rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        text: t('rename'),
        onclick: () => startRename(li, s),
      }),
      h('button', {
        type: 'button',
        class: 'rounded px-2 py-0.5 text-xs text-rose-500 hover:bg-white hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500',
        text: t('delete'),
        onclick: () => deleteSession(s._id),
      }),
    ]);
    li.append(open, actions);
    list.append(li);
  }
}

function startRename(li, s) {
  const input = h('input', {
    type: 'text',
    maxlength: '120',
    'aria-label': t('titleLabel'),
    class: 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
  });
  input.value = s.title;
  const done = (commit) => {
    if (commit && input.value.trim() !== s.title) renameSession(s._id, input.value.trim());
    else renderSessions();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true), { once: true });
  li.replaceChildren(h('div', { class: 'p-2' }, input));
  input.focus();
  input.select();
}

function renderModelSelect() {
  const sel = $('#model');
  const current = currentModel();
  const names = state.models.map((m) => m.name);
  if (current && !names.includes(current)) names.unshift(current);
  sel.replaceChildren(...names.map((n) => {
    const m = state.models.find((x) => x.name === n);
    const size = m?.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : '';
    return h('option', { value: n, text: n + size });
  }));
  sel.value = current;
  sel.disabled = !state.health.llm || !state.session;
}

function renderQuestions() {
  const wrap = $('#questions');
  wrap.replaceChildren();
  for (const b of BRANCHES) {
    const id = `answer-${b}`;
    const ta = h('textarea', {
      id,
      rows: '3',
      maxlength: '2000',
      placeholder: t(`ph_${b}`),
      class: 'mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
      oninput: (e) => onAnswerInput(b, e.target.value),
    });
    ta.value = state.session.answers?.[b] || '';
    const more = h('button', {
      type: 'button',
      'data-branch-more': b,
      class: 'llm-btn inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40',
      style: { color: COLORS[b] },
      onclick: () => expandBranches([b]),
    });
    wrap.append(h('div', {}, [
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        h('label', { for: id, class: 'flex items-center gap-2 text-sm font-semibold' }, [
          h('span', { class: 'inline-block h-2.5 w-2.5 shrink-0 rounded-full', style: { background: COLORS[b] }, 'aria-hidden': 'true' }),
          t(`q_${b}`),
        ]),
        more,
      ]),
      ta,
    ]));
  }
}

function onAnswerInput(branch, value) {
  state.session.answers[branch] = value;
  const patch = { answers: { [branch]: value } };
  if (branch === 'who' && state.titleAuto) {
    const suggestion = value.trim().replace(/\s+/g, ' ').slice(0, 60);
    const title = suggestion ? suggestion.charAt(0).toLocaleUpperCase() + suggestion.slice(1) : '';
    state.session.title = title;
    $('#title').value = title;
    patch.title = title;
    renderGraphLabels();
  }
  queueSave(patch);
  renderBusy();
}

function renderLegend() {
  $('#legend').replaceChildren(...BRANCHES.map((b) => h('li', { class: 'flex items-center gap-1.5' }, [
    h('span', { class: 'inline-block h-2.5 w-2.5 rounded-full', style: { background: COLORS[b] }, 'aria-hidden': 'true' }),
    t(`b_${b}`),
  ])));
}

function initGraph() {
  if (!window.cytoscape) return;
  if (graph) { graph.cy.destroy(); graph = null; }
  graph = createGraph($('#graph'), {
    onWordTap: (id) => {
      closePanel();
      const w = wordById(id);
      if (w) patchWord(id, { selected: !w.selected });
    },
    onWordMenu: (id) => openPanel({ kind: 'word', id }),
    onBranchTap: (b) => openPanel({ kind: 'branch', id: b }),
    onViewportChange: () => closePanel(),
  });
}

function renderGraphLabels() {
  if (!graph || !state.session) return;
  const branches = Object.fromEntries(BRANCHES.map((b) => [b, t(`b_${b}`)]));
  graph.setLabels({ root: state.session.title || t('project'), branches });
}

function renderWords() {
  const list = words();
  const selected = list.filter((w) => w.selected).length;
  $('#selected-count').textContent = t('selectedCount', { n: selected });
  const allOn = list.length > 0 && selected === list.length;
  const sa = $('#select-all');
  sa.textContent = allOn ? t('deselectAll') : t('selectAll');
  sa.disabled = !list.length;
  sa.onclick = () => bulkSelect(null, !allOn);
  show($('#graph-empty'), !list.length);
  renderPerBranchHint();
  graph?.syncWords(list);
  renderWordList();
  if (state.panel) renderPanel();
}

// Longest acronym reachable with the selected words under the words-per-branch cap.
function renderPerBranchHint() {
  const n = Number($('#per-branch').value);
  const selected = words().filter((w) => w.selected);
  const max = BRANCHES.reduce((sum, b) => sum + Math.min(n, selected.filter((w) => w.branch === b).length), 0)
    * ($('#chunks').checked ? 2 : 1);
  $('#per-branch-hint').textContent = t('perBranchHint', { n, max });
}

function wordChip(w) {
  const color = COLORS[w.branch];
  const toggle = h('button', {
    type: 'button',
    'aria-pressed': String(w.selected),
    class: 'rounded-l-full py-1 pl-3 pr-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900',
    style: w.selected ? { background: color, color: '#fff' } : { background: '#fff', color: '#64748b' },
    text: w.text,
    onclick: () => patchWord(w._id, { selected: !w.selected }),
  });
  const menu = h('button', {
    type: 'button',
    'aria-label': `${t('wordMenu')}: ${w.text}`,
    'aria-haspopup': 'dialog',
    class: 'rounded-r-full px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-900',
    style: w.selected ? { background: color, color: '#fff' } : { background: '#fff', color: '#64748b' },
    text: '⋯',
    onclick: (e) => openPanel({ kind: 'word', id: w._id, anchor: e.currentTarget }),
  });
  return h('li', {
    class: `inline-flex overflow-hidden rounded-full border ${w.selected ? '' : 'border-dashed'}`,
    style: { borderColor: color },
  }, [toggle, menu]);
}

function renderWordList() {
  const wrap = $('#word-list');
  const list = words();
  if (!list.length) {
    wrap.replaceChildren(h('p', { class: 'text-sm text-slate-500 md:col-span-2', text: t('noWords') }));
    // Still offer manual entry per branch
  } else {
    wrap.replaceChildren();
  }
  for (const b of BRANCHES) {
    const branchWords = list.filter((w) => w.branch === b);
    const input = h('input', {
      type: 'text',
      maxlength: '60',
      placeholder: t('addWordPh'),
      'aria-label': `${t('addWord')} (${t(`b_${b}`)})`,
      class: 'min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
    });
    const form = h('form', {
      class: 'mt-2 flex gap-2',
      onsubmit: async (e) => {
        e.preventDefault();
        if (await addManualWord(b, input.value)) { input.value = ''; wrap.querySelector(`[data-add="${b}"]`)?.focus(); }
      },
    }, [input, h('button', { type: 'submit', class: 'rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', text: t('add') })]);
    input.dataset.add = b;
    const allOn = branchWords.length && branchWords.every((w) => w.selected);
    wrap.append(h('div', {}, [
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        h('h3', { class: 'flex items-center gap-2 text-sm font-semibold' }, [
          h('span', { class: 'inline-block h-2.5 w-2.5 rounded-full', style: { background: COLORS[b] }, 'aria-hidden': 'true' }),
          `${t(`b_${b}`)} (${branchWords.filter((w) => w.selected).length}/${branchWords.length})`,
        ]),
        branchWords.length ? h('button', {
          type: 'button',
          class: 'rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
          text: allOn ? t('deselectAll') : t('selectAll'),
          onclick: () => bulkSelect(b, !allOn),
        }) : null,
      ]),
      h('ul', { class: 'mt-2 flex flex-wrap gap-1.5' }, branchWords.map(wordChip)),
      form,
    ]));
  }
}

// Bold the first N letters of a word (skipping accents/punctuation when counting).
function partNode(p) {
  const n = (p.letters || '').length;
  let count = 0;
  let cut = 0;
  const text = p.text || '';
  for (let i = 0; i < text.length && count < n; i++) {
    const base = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/[a-z]/i.test(base) || /[œæ]/i.test(text[i])) count++;
    cut = i + 1;
  }
  return h('span', {}, [
    h('strong', { class: 'font-bold', style: { color: COLORS[p.branch] || '#0f172a' }, text: text.slice(0, cut) }),
    text.slice(cut),
  ]);
}

function sortedAcronyms() {
  let list = [...(state.session?.acronyms || [])];
  if (state.filter === 'fav') list = list.filter((a) => a.favorite);
  if (state.filter === 'real') list = list.filter((a) => a.isRealWord);
  const scoreOf = (a) => (a.score ?? -1);
  if (state.sort === 'score') list.sort((a, b) => scoreOf(b) - scoreOf(a) || (b.engineScore || 0) - (a.engineScore || 0));
  if (state.sort === 'length') list.sort((a, b) => a.letters.length - b.letters.length || scoreOf(b) - scoreOf(a));
  if (state.sort === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function badge(text, cls) {
  return h('span', { class: `rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`, text });
}

function acronymCard(a) {
  const expansion = h('p', { class: 'mt-1 text-sm text-slate-600' });
  a.parts.forEach((p, i) => {
    if (i) expansion.append(' · ');
    expansion.append(partNode(p));
  });
  const branchesUsed = a.branchCoverage || new Set(a.parts.map((p) => p.branch)).size;
  const copyValue = `${a.letters} — ${a.parts.map((p) => p.text).join(' ')}`;
  const ids = a.parts.map((p) => p.wordId);
  const li = h('li', {
    class: `flex flex-col rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md ${a.favorite ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'}`,
    onmouseenter: () => graph?.highlight(ids),
    onmouseleave: () => graph?.clearHighlight(),
    onfocusin: () => graph?.highlight(ids),
    onfocusout: () => graph?.clearHighlight(),
  }, [
    h('div', { class: 'flex items-start justify-between gap-2' }, [
      h('p', { class: 'text-3xl font-black tracking-wider' }, a.parts.map((p) => h('span', { style: { color: COLORS[p.branch] }, text: p.letters }))),
      h('span', {
        class: `shrink-0 rounded-lg px-2 py-1 text-sm font-bold ${a.score == null ? 'bg-slate-100 text-slate-400' : a.score >= 70 ? 'bg-emerald-50 text-emerald-700' : a.score >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`,
        text: a.score == null ? t('scoreNone') : `${a.score}/100`,
      }),
    ]),
    expansion,
    h('div', { class: 'mt-2 flex flex-wrap gap-1.5' }, [
      a.isRealWord ? badge(t('realWord'), 'bg-sky-50 text-sky-700') : badge(t('invented'), 'bg-violet-50 text-violet-700'),
      badge(t('branchesCovered', { n: branchesUsed }), 'bg-slate-100 text-slate-600'),
      badge(a.source === 'llm' ? 'LLM' : 'dict', 'bg-slate-50 text-slate-400'),
    ]),
    a.rationale ? h('p', { class: 'mt-2 text-sm text-slate-700', text: a.rationale }) : null,
    a.tagline ? h('p', { class: 'mt-1 text-sm italic text-slate-500', text: getLang() === 'fr' ? `« ${a.tagline} »` : `“${a.tagline}”` }) : null,
    h('div', { class: 'mt-auto flex gap-1 pt-3' }, [
      h('button', {
        type: 'button',
        'aria-pressed': String(a.favorite),
        class: `rounded-md px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${a.favorite ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}`,
        text: `${a.favorite ? '★' : '☆'} ${t('favorite')}`,
        onclick: () => toggleFavorite(a),
      }),
      h('button', {
        type: 'button',
        class: 'rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
        text: t('copy'),
        onclick: () => copyText(copyValue),
      }),
      h('button', {
        type: 'button',
        class: 'ml-auto rounded-md px-2 py-1 text-sm text-rose-500 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500',
        text: t('delete'),
        'aria-label': `${t('delete')} ${a.letters}`,
        onclick: () => deleteAcronym(a),
      }),
    ]),
  ]);
  return li;
}

function renderAcronyms() {
  const all = state.session?.acronyms || [];
  const list = sortedAcronyms();
  $('#acronym-list').replaceChildren(...list.map(acronymCard));
  const empty = $('#acronym-empty');
  empty.textContent = all.length ? t('noAcronymsFiltered') : t('noAcronyms');
  show(empty, !list.length);
  $('#clear-acronyms').disabled = !all.some((a) => !a.favorite);
  $('#sort').value = state.sort;
  document.querySelectorAll('#filters [data-filter]').forEach((b) => {
    const on = b.dataset.filter === state.filter;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('bg-slate-900', on);
    b.classList.toggle('text-white', on);
  });
}

function setButtonBusy(btn, busy, label, busyLabel) {
  btn.replaceChildren(...(busy ? [spinner(), busyLabel] : [label]));
  btn.setAttribute('aria-busy', String(busy));
}

function renderBusy() {
  if (!state.session) return;
  const llm = state.health.llm;
  const wordsBusy = state.busy.has('words');
  const gen = $('#generate-words');
  setButtonBusy(gen, wordsBusy, t('generateWords'), t('generatingWords'));
  gen.disabled = !llm || wordsBusy || !BRANCHES.some(hasAnswer);

  document.querySelectorAll('[data-branch-more]').forEach((btn) => {
    const b = btn.dataset.branchMore;
    const busy = state.busy.has(`branch:${b}`) || wordsBusy;
    setButtonBusy(btn, state.busy.has(`branch:${b}`), t('regenerate'), t('generatingWords'));
    btn.disabled = !llm || busy || !hasAnswer(b);
  });

  const anyWordBusy = [...state.busy].find((k) => k === 'words' || k.startsWith('branch:') || k.startsWith('word:'));
  const ws = $('#words-status');
  ws.replaceChildren(...(anyWordBusy ? [spinner('text-indigo-500'), llmBusyMessage(anyWordBusy.startsWith('word:') ? 'expanding' : 'generatingWords')] : []));
  ws.style.display = anyWordBusy ? 'flex' : '';
  show(ws, !!anyWordBusy);

  const acr = state.busy.has('acronyms');
  const btn = $('#generate-acronyms');
  setButtonBusy(btn, acr, t('generateAcronyms'), t('generatingAcronyms'));
  btn.disabled = acr || !words().some((w) => w.selected);
  if (acr) {
    const st = $('#acronym-status');
    st.replaceChildren(spinner('text-slate-500'), state.health.llm ? llmBusyMessage('generatingAcronyms') : t('generatingAcronyms'));
    st.style.display = 'flex';
    show(st, true);
  } else {
    $('#acronym-status').style.display = '';
  }
  if (state.panel) renderPanel();
}

// ---------------------------------------------------------------------------
// Floating action panel

function openPanel({ kind, id, anchor = null }) {
  state.panel = { kind, id, anchor, mode: 'menu' };
  graph?.setActive(kind === 'word' ? id : `b-${id}`);
  renderPanel();
  const first = $('#panel').querySelector('button, input');
  first?.focus({ preventScroll: true });
}

function closePanel() {
  if (!state.panel) return;
  const anchor = state.panel.anchor;
  state.panel = null;
  graph?.setActive(null);
  show($('#panel'), false);
  if (anchor && document.body.contains(anchor)) anchor.focus({ preventScroll: true });
}

function panelButton(text, onclick, { danger = false, disabled = false } = {}) {
  return h('button', {
    type: 'button',
    disabled,
    class: `block w-full rounded-md px-2 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-rose-600 hover:bg-rose-50' : 'hover:bg-slate-100'}`,
    text,
    onclick,
  });
}

function panelInput(value, placeholder, onSubmit) {
  const input = h('input', {
    type: 'text',
    maxlength: '60',
    placeholder,
    'aria-label': placeholder,
    class: 'min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200',
  });
  input.value = value;
  return h('form', {
    class: 'flex gap-1.5',
    onsubmit: (e) => { e.preventDefault(); onSubmit(input.value); },
  }, [input, h('button', { type: 'submit', class: 'rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', text: t('save') })]);
}

function renderPanel() {
  const panel = $('#panel');
  const p = state.panel;
  if (!p || !state.session) { show(panel, false); return; }
  const llm = state.health.llm;
  let content;
  let rect;

  if (p.kind === 'word') {
    const w = wordById(p.id);
    if (!w) { closePanel(); return; }
    const busy = state.busy.has(`word:${w._id}`);
    const header = h('p', { class: 'mb-2 flex items-center gap-2 font-semibold' }, [
      h('span', { class: 'inline-block h-2.5 w-2.5 shrink-0 rounded-full', style: { background: COLORS[w.branch] } }),
      h('span', { class: 'truncate', text: w.text }),
    ]);
    if (p.mode === 'rename') {
      content = [header, panelInput(w.text, t('rename'), async (v) => {
        if (v.trim() && v.trim() !== w.text) await patchWord(w._id, { text: v.trim() });
        p.mode = 'menu';
        renderPanel();
      })];
    } else {
      content = [
        header,
        panelButton(w.selected ? t('deselect') : t('select'), () => patchWord(w._id, { selected: !w.selected })),
        panelButton(t('rename'), () => { p.mode = 'rename'; renderPanel(); $('#panel input')?.select(); }),
        h('button', {
          type: 'button',
          disabled: !llm || busy,
          class: 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40',
          onclick: () => expandWord(w._id),
        }, busy ? [spinner(), llmBusyMessage('expanding')] : [t('expand')]),
        panelButton(t('delete'), () => deleteWord(w._id), { danger: true }),
      ];
    }
    rect = p.anchor && document.body.contains(p.anchor) ? p.anchor.getBoundingClientRect() : graph?.nodeClientRect(w._id);
  } else {
    const b = p.id;
    const busy = state.busy.has(`branch:${b}`) || state.busy.has('words');
    const branchWords = words().filter((w) => w.branch === b);
    const header = h('p', { class: 'mb-2 flex items-center gap-2 font-semibold' }, [
      h('span', { class: 'inline-block h-2.5 w-2.5 shrink-0 rounded-full', style: { background: COLORS[b] } }),
      t(`q_${b}`),
    ]);
    if (p.mode === 'add') {
      content = [header, panelInput('', t('addWordPh'), async (v) => {
        if (await addManualWord(b, v)) { renderPanel(); $('#panel input')?.focus(); }
      })];
    } else {
      content = [
        header,
        h('button', {
          type: 'button',
          disabled: !llm || busy || !hasAnswer(b),
          class: 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40',
          onclick: () => expandBranches([b]),
        }, state.busy.has(`branch:${b}`) ? [spinner(), llmBusyMessage('generatingWords')] : [t('moreWords')]),
        panelButton(t('addWord'), () => { p.mode = 'add'; renderPanel(); $('#panel input')?.focus(); }),
        panelButton(t('selectAll'), () => bulkSelect(b, true), { disabled: !branchWords.length }),
        panelButton(t('deselectAll'), () => bulkSelect(b, false), { disabled: !branchWords.length }),
      ];
    }
    rect = graph?.nodeClientRect(`b-${b}`);
  }

  panel.replaceChildren(...content);
  panel.setAttribute('aria-label', p.kind === 'word' ? t('wordMenu') : t(`b_${p.id}`));
  show(panel, true);
  if (!rect) return;
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let left = rect.right + 8;
  if (left + pw > vw - 8) left = Math.max(8, rect.left - pw - 8);
  let top = rect.top;
  if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
  panel.style.left = `${Math.max(8, left)}px`;
  panel.style.top = `${Math.max(8, top)}px`;
}

// ---------------------------------------------------------------------------
// Drawer (mobile sidebar)

function openDrawer() {
  $('#sidebar').classList.remove('-translate-x-full');
  show($('#drawer-backdrop'), true);
}

function closeDrawer() {
  $('#sidebar').classList.add('-translate-x-full');
  show($('#drawer-backdrop'), false);
}

// ---------------------------------------------------------------------------
// Wiring

function bindStatic() {
  $('#new-session').addEventListener('click', createSession);
  $('#empty-new').addEventListener('click', createSession);
  $('#drawer-open').addEventListener('click', openDrawer);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);

  $('#title').addEventListener('input', (e) => {
    state.titleAuto = false;
    state.session.title = e.target.value;
    renderGraphLabels();
    queueSave({ title: e.target.value });
  });

  $('#language').addEventListener('change', (e) => {
    const lang = e.target.value;
    state.session.language = lang;
    state.langHint = words().length > 0;
    setLang(lang);
    queueSave({ language: lang });
    renderAll();
  });

  $('#model').addEventListener('change', (e) => {
    state.session.model = e.target.value;
    queueSave({ model: e.target.value });
    warmup();
  });

  $('#banner-lang-close').addEventListener('click', () => { state.langHint = false; renderBanners(); });
  document.querySelectorAll('.banner-retry').forEach((b) => b.addEventListener('click', async () => {
    const hadDb = state.health.db;
    const hadLlm = state.health.llm;
    await checkHealth();
    if (!hadDb && state.health.db) await boot({ skipHealth: true });
    else if (!hadLlm && state.health.llm) { await loadModels(); renderBusy(); warmup(); }
    if (!state.health.db || !state.health.llm) toast(t(state.health.db ? 'llmDown' : 'dbDown'));
  }));

  $('#generate-words').addEventListener('click', () => expandBranches(BRANCHES.filter(hasAnswer)));

  document.querySelectorAll('[data-graph]').forEach((b) => b.addEventListener('click', () => {
    if (!graph) return;
    closePanel();
    const action = b.dataset.graph;
    if (action === 'fit') graph.fit();
    if (action === 'zoom-in') graph.zoom(1.25);
    if (action === 'zoom-out') graph.zoom(0.8);
    if (action === 'relayout') graph.relayout();
  }));

  $('#acronym-form').addEventListener('submit', (e) => { e.preventDefault(); generateAcronyms(); });
  $('#per-branch').addEventListener('change', renderPerBranchHint);
  $('#chunks').addEventListener('change', renderPerBranchHint);
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderAcronyms(); });
  document.querySelectorAll('#filters [data-filter]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; renderAcronyms(); }));
  $('#clear-acronyms').addEventListener('click', clearAcronyms);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); closeDrawer(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!state.panel) return;
    const panel = $('#panel');
    if (panel.contains(e.target) || e.target.closest('#graph') || state.panel.anchor?.contains(e.target)) return;
    closePanel();
  });
  window.addEventListener('resize', () => { closePanel(); graph?.resize(); });
  window.addEventListener('popstate', () => {
    const id = sessionIdFromUrl();
    if (id && id !== state.session?._id) openSession(id, { push: false });
  });
  $('#graph').addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('beforeunload', () => {
    if (!pendingPatch) return;
    fetch(`/api/sessions/${pendingPatch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingPatch.body),
      keepalive: true,
    });
  });
}

async function boot({ skipHealth = false } = {}) {
  if (!skipHealth) await checkHealth();
  await Promise.all([loadModels(), loadSessions()]);
  const id = sessionIdFromUrl() || state.sessions[0]?._id;
  if (id && state.health.db) {
    await openSession(id, { push: false });
    if (!sessionIdFromUrl() && state.session) setUrl(state.session._id, true);
  } else {
    renderAll({ resetGraph: true });
    warmup();
  }
}

setLang('fr');
applyStatic();
bindStatic();
boot();
