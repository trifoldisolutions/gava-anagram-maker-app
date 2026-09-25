// Lazy-loaded, cached dictionaries of normalized words per language.
const fs = require('fs');
const path = require('path');
const { normalizeLetters } = require('./normalize');

const SOURCES = {
  fr: 'an-array-of-french-words',
  en: 'an-array-of-english-words',
};

const allWords = new Map();   // lang → string[] (normalized, deduped)
const wordSets = new Map();   // lang → Set
const rangeCache = new Map(); // `${lang}:${min}:${max}` → string[]

function loadAll(lang) {
  if (allWords.has(lang)) return allWords.get(lang);
  const pkg = SOURCES[lang];
  if (!pkg) throw new Error(`Unknown dictionary language: ${lang}`);
  const file = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'index.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const set = new Set();
  for (const entry of raw) {
    // Skip compounds and abbreviations ("c'est-à-dire", "U.S.A.")
    if (/[\s'’\-.]/.test(entry)) continue;
    const w = normalizeLetters(entry);
    if (w.length >= 2) set.add(w);
  }
  const list = [...set];
  allWords.set(lang, list);
  wordSets.set(lang, set);
  return list;
}

function getSet(lang) {
  loadAll(lang);
  return wordSets.get(lang);
}

function getRange(lang, minLen, maxLen) {
  const key = `${lang}:${minLen}:${maxLen}`;
  if (!rangeCache.has(key)) {
    rangeCache.set(key, loadAll(lang).filter((w) => w.length >= minLen && w.length <= maxLen));
  }
  return rangeCache.get(key);
}

function isWord(lang, letters) {
  return getSet(lang).has(normalizeLetters(letters));
}

module.exports = { getSet, getRange, isWord };
