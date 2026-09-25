const express = require('express');
const mongoose = require('mongoose');
const BrainstormSession = require('../models/BrainstormSession');
const llm = require('../services/llm');
const prompts = require('../services/llm/prompts');
const dictionary = require('../services/acronym/dictionary');
const { wordKey, cleanWordList } = require('../services/acronym/normalize');
const { generateEngineCandidates, candidateFromIds, candidateKey, buildPool, letterCapacity } = require('../services/acronym/engine');

const { BRANCHES, MAX_WORDS, MAX_ACRONYMS } = BrainstormSession;
const LANGUAGES = ['fr', 'en'];
const RANK_CAP = 80;
const RANK_BATCH = 40;

const router = express.Router();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const dbReady = () => mongoose.connection.readyState === 1;
const isId = (id) => mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(String(id));
const sessionModel = (s) => s.model || llm.defaultModel();

function requireDb(req, res, next) {
  if (!dbReady()) throw new ApiError(503, 'database_unavailable', 'MongoDB is not connected');
  next();
}

async function loadSession(id) {
  if (!isId(id)) throw new ApiError(404, 'session_not_found', 'Session not found');
  const session = await BrainstormSession.findById(id);
  if (!session) throw new ApiError(404, 'session_not_found', 'Session not found');
  return session;
}

function findWord(session, wordId) {
  const word = isId(wordId) ? session.words.id(wordId) : null;
  if (!word) throw new ApiError(404, 'word_not_found', 'Word not found');
  return word;
}

function branchKeys(session, branch) {
  return new Set(session.words.filter((w) => w.branch === branch).map((w) => wordKey(w.text)));
}

function cleanText(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || text.length > 60) throw new ApiError(400, 'invalid_text', 'Word text must be 1–60 characters');
  return text;
}

function newWord(branch, text, source, parentId = null) {
  return { _id: new mongoose.Types.ObjectId(), branch, text, selected: true, source, parentId };
}

async function pushWords(sessionId, words) {
  await BrainstormSession.updateOne({ _id: sessionId }, { $push: { words: { $each: words } } });
}

// ---------------------------------------------------------------------------
// Health & LLM

router.get('/health', async (req, res) => {
  res.json({
    db: dbReady(),
    llm: await llm.isAvailable(),
    provider: llm.providerName(),
    defaultModel: llm.defaultModel(),
  });
});

router.get('/models', async (req, res) => {
  res.json({ models: await llm.listModels(), defaultModel: llm.defaultModel() });
});

router.post('/llm/warmup', async (req, res) => {
  const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : llm.defaultModel();
  const started = Date.now();
  await llm.warmup(model);
  res.json({ ok: true, model, ms: Date.now() - started });
});

// ---------------------------------------------------------------------------
// Sessions

router.use('/sessions', requireDb);

router.get('/sessions', async (req, res) => {
  const sessions = await BrainstormSession.find({}, { title: 1, language: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .lean();
  res.json({ sessions });
});

router.post('/sessions', async (req, res) => {
  const { language, model } = req.body || {};
  const session = await BrainstormSession.create({
    language: LANGUAGES.includes(language) ? language : 'fr',
    model: typeof model === 'string' ? model.slice(0, 200) : '',
  });
  res.status(201).json({ session });
});

router.get('/sessions/:id', async (req, res) => {
  res.json({ session: await loadSession(req.params.id) });
});

router.patch('/sessions/:id', async (req, res) => {
  if (!isId(req.params.id)) throw new ApiError(404, 'session_not_found', 'Session not found');
  const body = req.body || {};
  const $set = {};
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length > 120) throw new ApiError(400, 'invalid_title', 'Title must be ≤ 120 characters');
    $set.title = body.title.trim();
  }
  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) throw new ApiError(400, 'invalid_language', 'Language must be fr or en');
    $set.language = body.language;
  }
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.length > 200) throw new ApiError(400, 'invalid_model', 'Invalid model');
    $set.model = body.model;
  }
  if (body.answers !== undefined) {
    if (typeof body.answers !== 'object' || body.answers === null) throw new ApiError(400, 'invalid_answers', 'answers must be an object');
    for (const b of BRANCHES) {
      if (body.answers[b] === undefined) continue;
      if (typeof body.answers[b] !== 'string' || body.answers[b].length > 2000) {
        throw new ApiError(400, 'invalid_answers', `answers.${b} must be a string ≤ 2000 characters`);
      }
      $set[`answers.${b}`] = body.answers[b];
    }
  }
  const session = await BrainstormSession.findByIdAndUpdate(req.params.id, { $set }, { returnDocument: 'after', runValidators: true });
  if (!session) throw new ApiError(404, 'session_not_found', 'Session not found');
  res.json({ session: { _id: session._id, title: session.title, language: session.language, model: session.model, answers: session.answers, updatedAt: session.updatedAt } });
});

router.delete('/sessions/:id', async (req, res) => {
  if (!isId(req.params.id)) throw new ApiError(404, 'session_not_found', 'Session not found');
  const deleted = await BrainstormSession.findByIdAndDelete(req.params.id);
  if (!deleted) throw new ApiError(404, 'session_not_found', 'Session not found');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Words

router.post('/sessions/:id/expand', async (req, res) => {
  const session = await loadSession(req.params.id);
  const requested = Array.isArray(req.body?.branches) ? req.body.branches.filter((b) => BRANCHES.includes(b)) : BRANCHES;
  const branches = requested.filter((b) => (session.answers?.[b] || '').trim());
  if (!branches.length) throw new ApiError(422, 'no_answers', 'Answer at least one question first');
  if (session.words.length >= MAX_WORDS) throw new ApiError(422, 'word_limit', `A session can hold at most ${MAX_WORDS} words`);

  const answers = session.answers.toObject ? session.answers.toObject() : session.answers;
  const results = await Promise.allSettled(branches.map(async (branch) => {
    const existing = session.words.filter((w) => w.branch === branch).map((w) => w.text);
    const p = prompts.branchExpansion({ language: session.language, branch, answers, existing: existing.slice(0, 80) });
    const out = await llm.chatJSON({ model: sessionModel(session), ...p });
    return cleanWordList(out.words, branchKeys(session, branch)).slice(0, 12).map((t) => newWord(branch, t, 'llm'));
  }));

  const errors = {};
  let added = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') added.push(...r.value);
    else errors[branches[i]] = { error: r.reason.code || 'llm_error', message: r.reason.message };
  });
  if (!added.length && Object.keys(errors).length === branches.length) throw results[0].reason;

  added = added.slice(0, MAX_WORDS - session.words.length);
  if (added.length) await pushWords(session._id, added);
  res.json({ words: added, errors });
});

router.post('/sessions/:id/words', async (req, res) => {
  const session = await loadSession(req.params.id);
  const { branch, parentId } = req.body || {};
  const text = cleanText(req.body?.text);
  let wordBranch = branch;
  if (parentId) {
    wordBranch = findWord(session, parentId).branch;
  } else if (!BRANCHES.includes(branch)) {
    throw new ApiError(400, 'invalid_branch', 'branch must be one of who, what, how, why');
  }
  if (session.words.length >= MAX_WORDS) throw new ApiError(422, 'word_limit', `A session can hold at most ${MAX_WORDS} words`);
  if (branchKeys(session, wordBranch).has(wordKey(text))) throw new ApiError(422, 'duplicate_word', 'This word already exists in that branch');
  const word = newWord(wordBranch, text, 'user', parentId || null);
  await pushWords(session._id, [word]);
  res.status(201).json({ word });
});

router.post('/sessions/:id/words/bulk-select', async (req, res) => {
  if (!isId(req.params.id)) throw new ApiError(404, 'session_not_found', 'Session not found');
  const { branch, selected } = req.body || {};
  if (typeof selected !== 'boolean') throw new ApiError(400, 'invalid_selected', 'selected must be a boolean');
  if (branch !== undefined && !BRANCHES.includes(branch)) throw new ApiError(400, 'invalid_branch', 'Invalid branch');
  const update = branch
    ? [{ $set: { 'words.$[w].selected': selected } }, { arrayFilters: [{ 'w.branch': branch }] }]
    : [{ $set: { 'words.$[].selected': selected } }, {}];
  const r = await BrainstormSession.updateOne({ _id: req.params.id }, update[0], update[1]);
  if (!r.matchedCount) throw new ApiError(404, 'session_not_found', 'Session not found');
  res.json({ ok: true, branch: branch || null, selected });
});

router.patch('/sessions/:id/words/:wordId', async (req, res) => {
  const session = await loadSession(req.params.id);
  const word = findWord(session, req.params.wordId);
  const $set = {};
  if (req.body?.text !== undefined) {
    const text = cleanText(req.body.text);
    const clash = session.words.some((w) => w.branch === word.branch && !w._id.equals(word._id) && wordKey(w.text) === wordKey(text));
    if (clash) throw new ApiError(422, 'duplicate_word', 'This word already exists in that branch');
    $set['words.$.text'] = text;
  }
  if (req.body?.selected !== undefined) {
    if (typeof req.body.selected !== 'boolean') throw new ApiError(400, 'invalid_selected', 'selected must be a boolean');
    $set['words.$.selected'] = req.body.selected;
  }
  if (!Object.keys($set).length) throw new ApiError(400, 'nothing_to_update', 'Provide text or selected');
  const updated = await BrainstormSession.findOneAndUpdate(
    { _id: session._id, 'words._id': word._id },
    { $set },
    { returnDocument: 'after', projection: { words: { $elemMatch: { _id: word._id } } } }
  );
  if (!updated?.words?.length) throw new ApiError(404, 'word_not_found', 'Word not found');
  res.json({ word: updated.words[0] });
});

router.delete('/sessions/:id/words/:wordId', async (req, res) => {
  const session = await loadSession(req.params.id);
  const root = findWord(session, req.params.wordId);
  const ids = new Set([String(root._id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of session.words) {
      if (w.parentId && ids.has(String(w.parentId)) && !ids.has(String(w._id))) {
        ids.add(String(w._id));
        grew = true;
      }
    }
  }
  const objectIds = [...ids].map((id) => new mongoose.Types.ObjectId(id));
  await BrainstormSession.updateOne({ _id: session._id }, { $pull: { words: { _id: { $in: objectIds } } } });
  res.json({ deleted: [...ids] });
});

router.post('/sessions/:id/words/:wordId/expand', async (req, res) => {
  const session = await loadSession(req.params.id);
  const seed = findWord(session, req.params.wordId);
  if (session.words.length >= MAX_WORDS) throw new ApiError(422, 'word_limit', `A session can hold at most ${MAX_WORDS} words`);
  const answers = session.answers.toObject ? session.answers.toObject() : session.answers;
  const existing = session.words.filter((w) => w.branch === seed.branch).map((w) => w.text);
  const p = prompts.wordExpansion({ language: session.language, branch: seed.branch, seed: seed.text, answers, existing: existing.slice(0, 80) });
  const out = await llm.chatJSON({ model: sessionModel(session), ...p });
  const words = cleanWordList(out.words, branchKeys(session, seed.branch))
    .slice(0, 8)
    .slice(0, MAX_WORDS - session.words.length)
    .map((t) => newWord(seed.branch, t, 'llm', seed._id));
  if (words.length) await pushWords(session._id, words);
  res.json({ words });
});

// ---------------------------------------------------------------------------
// Acronyms

function intInRange(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 8) throw new ApiError(400, 'invalid_length', 'Lengths must be integers between 2 and 8');
  return n;
}

async function creativePass({ session, answers, selected, opts }) {
  const idMap = new Map();
  const idWords = selected.map((w, i) => {
    const id = `w${i + 1}`;
    idMap.set(id, w);
    return { id, branch: w.branch, text: w.text };
  });
  const p = prompts.creativeAcronyms({ language: session.language, answers, idWords, minLength: opts.minLength, maxLength: opts.maxLength, maxPerBranch: opts.maxPerBranch });
  const out = await llm.chatJSON({ model: sessionModel(session), ...p });
  const list = Array.isArray(out.acronyms) ? out.acronyms : [];
  const dict = dictionary.getSet(session.language);
  const found = [];
  for (const item of list.slice(0, 40)) {
    const c = candidateFromIds(item?.ids, idMap, opts);
    if (!c) continue;
    c.isRealWord = dict.has(c.letters);
    if (opts.realWordsOnly && !c.isRealWord) continue;
    found.push(c);
  }
  return found;
}

async function rankPass({ session, answers, candidates }) {
  const ranked = [];
  let failed = null;
  const batches = [];
  for (let i = 0; i < candidates.length; i += RANK_BATCH) batches.push(candidates.slice(i, i + RANK_BATCH));
  // Batches run concurrently (Ollama can serve parallel requests); ranked[] keeps batch order.
  await Promise.all(batches.map(async (batch, bi) => {
    try {
      const p = prompts.rankAcronyms({ language: session.language, answers, candidates: batch });
      const out = await llm.chatJSON({ model: sessionModel(session), ...p });
      const byLetters = new Map();
      for (const r of Array.isArray(out.results) ? out.results : []) {
        if (r && typeof r.letters === 'string') byLetters.set(r.letters.toUpperCase().replace(/[^A-Z]/g, ''), r);
      }
      ranked[bi] = [];
      for (const c of batch) {
        const r = byLetters.get(c.letters);
        if (!r || r.keep === false) continue; // unrated or rejected by the LLM
        const score = Number(r.score);
        ranked[bi].push({
          ...c,
          score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
          rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 240) : '',
          tagline: typeof r.tagline === 'string' ? r.tagline.slice(0, 160) : '',
        });
      }
    } catch (err) {
      failed = err;
      ranked[bi] = batch.map((c) => ({ ...c, score: null }));
    }
  }));
  return { ranked: ranked.flat(), failed };
}

router.post('/sessions/:id/acronyms/generate', async (req, res) => {
  const session = await loadSession(req.params.id);
  const body = req.body || {};
  const opts = {
    minLength: intInRange(body.minLength, 3),
    maxLength: intInRange(body.maxLength, 6),
    realWordsOnly: body.realWordsOnly === true,
    allowChunks: body.allowChunks === true,
    maxPerBranch: body.maxPerBranch === undefined ? 1 : Number(body.maxPerBranch),
  };
  if (opts.minLength > opts.maxLength) throw new ApiError(400, 'invalid_length', 'minLength must be ≤ maxLength');
  if (![1, 2, 3].includes(opts.maxPerBranch)) throw new ApiError(400, 'invalid_per_branch', 'maxPerBranch must be 1, 2 or 3');
  if (session.acronyms.length >= MAX_ACRONYMS) throw new ApiError(422, 'acronym_limit', `A session can hold at most ${MAX_ACRONYMS} acronyms`);

  const selected = session.words.filter((w) => w.selected);
  if (selected.length < opts.minLength) {
    throw new ApiError(422, 'not_enough_words', `Select at least ${opts.minLength} words`);
  }
  const capacity = letterCapacity(buildPool(selected), opts);
  if (capacity < opts.minLength) {
    throw new ApiError(422, 'length_unreachable', `With these words and ${opts.maxPerBranch} word(s) per branch, acronyms can have at most ${capacity} letters`);
  }
  const answers = session.answers.toObject ? session.answers.toObject() : session.answers;

  const existing = new Set(session.acronyms.map((a) => candidateKey(a)));

  // 1. Deterministic dictionary pass
  const started = Date.now();
  const engine = generateEngineCandidates({
    words: selected,
    dictionary: dictionary.getRange(session.language, opts.minLength, opts.maxLength),
    exclude: existing,
    ...opts,
  });
  const timings = { engineMs: Date.now() - started };

  // 2. LLM creative pass
  const llmUp = await llm.isAvailable();
  let creative = [];
  let llmError = null;
  if (llmUp) {
    try {
      const t0 = Date.now();
      creative = await creativePass({ session, answers, selected, opts });
      timings.creativeMs = Date.now() - t0;
    } catch (err) {
      llmError = err;
    }
  }

  // 3. Merge, dropping anything the session already has
  const merged = [];
  for (const c of [...creative, ...engine]) {
    const key = candidateKey(c);
    if (existing.has(key)) continue;
    existing.add(key);
    merged.push(c);
  }
  let candidates = merged.slice(0, RANK_CAP);

  // 4. LLM ranking pass
  let llmSkipped = !llmUp;
  if (llmUp && candidates.length) {
    const t0 = Date.now();
    const { ranked, failed } = await rankPass({ session, answers, candidates });
    timings.rankMs = Date.now() - t0;
    candidates = ranked;
    if (failed) { llmError = failed; llmSkipped = true; }
  } else {
    candidates = candidates.map((c) => ({ ...c, score: null }));
  }

  // 5. Append
  const room = MAX_ACRONYMS - session.acronyms.length;
  const acronyms = candidates.slice(0, room).map((c) => ({
    _id: new mongoose.Types.ObjectId(),
    letters: c.letters,
    parts: c.parts.map((p) => ({ wordId: new mongoose.Types.ObjectId(p.wordId), text: p.text, branch: p.branch, letters: p.letters })),
    isRealWord: !!c.isRealWord,
    branchCoverage: c.branchCoverage,
    engineScore: c.engineScore,
    score: c.score ?? null,
    rationale: c.rationale || '',
    tagline: c.tagline || '',
    source: c.source,
    favorite: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  if (acronyms.length) {
    await BrainstormSession.updateOne({ _id: session._id }, { $push: { acronyms: { $each: acronyms } } });
  }

  res.json({
    acronyms,
    llmSkipped,
    llmError: llmError ? { error: llmError.code || 'llm_error', message: llmError.message } : null,
    stats: { engine: engine.length, creative: creative.length, kept: acronyms.length, ...timings },
  });
});

router.patch('/sessions/:id/acronyms/:acronymId', async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.acronymId)) throw new ApiError(404, 'acronym_not_found', 'Acronym not found');
  if (typeof req.body?.favorite !== 'boolean') throw new ApiError(400, 'invalid_favorite', 'favorite must be a boolean');
  const r = await BrainstormSession.updateOne(
    { _id: req.params.id, 'acronyms._id': req.params.acronymId },
    { $set: { 'acronyms.$.favorite': req.body.favorite } }
  );
  if (!r.matchedCount) throw new ApiError(404, 'acronym_not_found', 'Acronym not found');
  res.json({ ok: true, favorite: req.body.favorite });
});

router.delete('/sessions/:id/acronyms/:acronymId', async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.acronymId)) throw new ApiError(404, 'acronym_not_found', 'Acronym not found');
  const r = await BrainstormSession.updateOne(
    { _id: req.params.id, 'acronyms._id': req.params.acronymId },
    { $pull: { acronyms: { _id: req.params.acronymId } } }
  );
  if (!r.matchedCount) throw new ApiError(404, 'acronym_not_found', 'Acronym not found');
  res.json({ ok: true });
});

router.post('/sessions/:id/acronyms/clear', async (req, res) => {
  if (!isId(req.params.id)) throw new ApiError(404, 'session_not_found', 'Session not found');
  const r = await BrainstormSession.updateOne({ _id: req.params.id }, { $pull: { acronyms: { favorite: { $ne: true } } } });
  if (!r.matchedCount) throw new ApiError(404, 'session_not_found', 'Session not found');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// JSON 404 + error handler for everything under /api

router.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `No API route for ${req.method} ${req.originalUrl}` });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof ApiError || err instanceof llm.LLMError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
  }
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: 'validation_error', message: err.message });
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'server_error', message: 'Unexpected server error' });
});

router.routes = [
  { method: 'GET', path: '/health', label: 'DB + LLM health' },
  { method: 'GET', path: '/models', label: 'List LLM models' },
  { method: 'POST', path: '/llm/warmup', label: 'Load a model into memory' },
  { method: 'GET', path: '/sessions', label: 'List sessions' },
  { method: 'POST', path: '/sessions', label: 'Create session' },
  { method: 'GET', path: '/sessions/:id', label: 'Get session' },
  { method: 'PATCH', path: '/sessions/:id', label: 'Update session' },
  { method: 'DELETE', path: '/sessions/:id', label: 'Delete session' },
  { method: 'POST', path: '/sessions/:id/expand', label: 'LLM words for branches' },
  { method: 'POST', path: '/sessions/:id/words', label: 'Add manual word' },
  { method: 'PATCH', path: '/sessions/:id/words/:wordId', label: 'Rename / (de)select word' },
  { method: 'POST', path: '/sessions/:id/words/bulk-select', label: 'Bulk (de)select words' },
  { method: 'DELETE', path: '/sessions/:id/words/:wordId', label: 'Delete word + descendants' },
  { method: 'POST', path: '/sessions/:id/words/:wordId/expand', label: 'LLM child words' },
  { method: 'POST', path: '/sessions/:id/acronyms/generate', label: 'Generate acronyms' },
  { method: 'PATCH', path: '/sessions/:id/acronyms/:acronymId', label: 'Toggle favorite' },
  { method: 'DELETE', path: '/sessions/:id/acronyms/:acronymId', label: 'Delete acronym' },
  { method: 'POST', path: '/sessions/:id/acronyms/clear', label: 'Clear non-favorites' },
];

module.exports = router;
