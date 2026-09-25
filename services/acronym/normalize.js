// Letter normalization shared by the engine, dictionary and API.

const LIGATURES = { 'Œ': 'OE', 'œ': 'oe', 'Æ': 'AE', 'æ': 'ae', 'ß': 'ss' };

function stripAccents(text) {
  return String(text || '')
    .replace(/[ŒœÆæß]/g, (c) => LIGATURES[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// "Équipe" → "EQUIPE"; keeps A–Z only.
function normalizeLetters(text) {
  return stripAccents(text).toUpperCase().replace(/[^A-Z]/g, '');
}

// Case- and accent-insensitive key used to dedupe words.
function wordKey(text) {
  return stripAccents(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Letters a word can contribute, from its first word only ("Flux vidéo" → F / FL).
function initials(text) {
  const first = String(text || '').trim().split(/[\s\-–—]+/).find((w) => normalizeLetters(w)) || '';
  const letters = normalizeLetters(first);
  return {
    one: letters.slice(0, 1) || null,
    two: letters.length >= 2 ? letters.slice(0, 2) : null,
  };
}

// Trim, drop empty/too long items, dedupe against each other and an existing key set.
function cleanWordList(items, existingKeys = new Set(), maxLen = 60) {
  const seen = new Set(existingKeys);
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (typeof raw !== 'string') continue;
    const text = raw.replace(/\s+/g, ' ').replace(/^[\s\-•*\d.)]+/, '').trim();
    if (!text || text.length > maxLen || !normalizeLetters(text)) continue;
    const key = wordKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.charAt(0).toLocaleUpperCase() + text.slice(1));
  }
  return out;
}

module.exports = { stripAccents, normalizeLetters, wordKey, initials, cleanWordList };
