// All LLM prompt builders. System prompts are written in the session language.

const BRANCHES = ['who', 'what', 'how', 'why'];

const QUESTIONS = {
  fr: {
    who: 'Qui sont-ils ?',
    what: 'Que font-ils ?',
    how: 'Comment le font-ils ?',
    why: 'Pourquoi le font-ils ? Quelle solution apportent-ils ?',
  },
  en: {
    who: 'Who are they?',
    what: 'What do they do?',
    how: 'How do they do it?',
    why: 'Why do they do it / what solution do they bring?',
  },
};

const T = {
  fr: {
    system:
      "Tu es un expert en naming qui aide à trouver un acronyme pour un projet. Tu réponds uniquement en JSON valide, en français.",
    context: 'Contexte du projet',
    empty: '(pas de réponse)',
    branchTask: (q, a, existing) =>
      `Branche à développer : « ${q} »\nRéponse : « ${a} »\n` +
      (existing.length ? `Mots déjà présents (ne pas répéter) : ${existing.join(', ')}\n` : '') +
      '\nDonne 8 à 12 mots en français : synonymes, quasi-synonymes ou concepts fortement liés, utilisables dans un nom de projet. ' +
      'Des mots simples ou de très courtes expressions nominales (2 mots maximum). Mélange des options évidentes et moins évidentes. ' +
      "Pas d'articles, pas de doublons, chaque mot commence par une majuscule.\n" +
      'Format : {"words": ["...", "..."]}',
    wordTask: (q, seed, existing) =>
      `Branche : « ${q} »\nMot de départ : « ${seed} »\n` +
      (existing.length ? `Mots déjà présents (ne pas répéter) : ${existing.join(', ')}\n` : '') +
      `\nDonne 6 à 8 mots en français liés à « ${seed} », dans le sens de cette branche et du projet. ` +
      "Mots simples ou expressions de 2 mots maximum, sans articles, avec une majuscule.\n" +
      'Format : {"words": ["...", "..."]}',
    creativeTask: (min, max, perBranch) =>
      `À partir des mots ci-dessus (identifiés par w1, w2, …), propose 15 à 20 acronymes mémorables et prononçables ` +
      `(vrais mots ou mots inventés) de ${min} à ${max} lettres. Chaque mot apporte sa première lettre ; ` +
      "un mot ne peut servir qu'une fois par acronyme ; l'ordre est libre et on peut mélanger les branches. " +
      (perBranch === 1
        ? 'Règle stricte : au plus UN mot par branche [Qui]/[Quoi]/[Comment]/[Pourquoi] dans un même acronyme. '
        : `Règle stricte : au plus ${perBranch} mots de la même branche dans un même acronyme. `) +
      "Donne pour chaque acronyme la liste ordonnée des identifiants des mots.\n" +
      'Format : {"acronyms": [{"ids": ["w3", "w1", "w7"]}]}',
    rankTask:
      'Évalue chaque acronyme candidat ci-dessous pour ce projet selon : mémorisation, prononciation, ' +
      'sens en lien avec le projet, ton professionnel. Mets "keep": false pour les candidats vulgaires, ' +
      "offensants, ridicules ou sans intérêt. Pour chaque candidat : un score de 0 à 100, une justification " +
      "(20 mots max) et un slogan court (12 mots max), en français.\n" +
      'Format : {"results": [{"letters": "SERA", "keep": true, "score": 80, "rationale": "...", "tagline": "..."}]}',
    branchNames: { who: 'Qui', what: 'Quoi', how: 'Comment', why: 'Pourquoi' },
  },
  en: {
    system:
      'You are a naming expert helping find an acronym for a project. You answer only with valid JSON, in English.',
    context: 'Project context',
    empty: '(no answer)',
    branchTask: (q, a, existing) =>
      `Branch to expand: "${q}"\nAnswer: "${a}"\n` +
      (existing.length ? `Words already present (do not repeat): ${existing.join(', ')}\n` : '') +
      '\nGive 8 to 12 English words: synonyms, near-synonyms or strongly related concepts suitable for a project name. ' +
      'Single words or very short noun phrases (2 words max). Mix obvious and less obvious options. ' +
      'No articles, no duplicates, capitalize each word.\n' +
      'Format: {"words": ["...", "..."]}',
    wordTask: (q, seed, existing) =>
      `Branch: "${q}"\nSeed word: "${seed}"\n` +
      (existing.length ? `Words already present (do not repeat): ${existing.join(', ')}\n` : '') +
      `\nGive 6 to 8 English words related to "${seed}", within this branch's meaning and the project. ` +
      'Single words or 2-word phrases max, no articles, capitalized.\n' +
      'Format: {"words": ["...", "..."]}',
    creativeTask: (min, max, perBranch) =>
      `Using the words above (identified by w1, w2, …), propose 15 to 20 memorable, pronounceable acronyms ` +
      `(real or invented words) of ${min} to ${max} letters. Each word contributes its first letter; ` +
      'a word can be used only once per acronym; order is free and branches can be mixed. ' +
      (perBranch === 1
        ? 'Strict rule: at most ONE word from each branch [Who]/[What]/[How]/[Why] in the same acronym. '
        : `Strict rule: at most ${perBranch} words from the same branch in the same acronym. `) +
      'For each acronym give the ordered list of word ids.\n' +
      'Format: {"acronyms": [{"ids": ["w3", "w1", "w7"]}]}',
    rankTask:
      'Rate each candidate acronym below for this project on: memorability, pronounceability, ' +
      'meaning relevant to the project, professional tone. Set "keep": false for vulgar, offensive, ' +
      'silly or meaningless candidates. For each candidate: a score 0–100, a rationale (≤ 20 words) ' +
      'and a short tagline (≤ 12 words), in English.\n' +
      'Format: {"results": [{"letters": "SERA", "keep": true, "score": 80, "rationale": "...", "tagline": "..."}]}',
    branchNames: { who: 'Who', what: 'What', how: 'How', why: 'Why' },
  },
};

const lang = (l) => (T[l] ? l : 'fr');

function contextBlock(language, answers = {}) {
  const t = T[lang(language)];
  const q = QUESTIONS[lang(language)];
  const lines = BRANCHES.map((b) => `- ${q[b]} ${(answers[b] || '').trim() || t.empty}`);
  return `${t.context} :\n${lines.join('\n')}`;
}

function branchExpansion({ language, branch, answers, existing = [] }) {
  const l = lang(language);
  return {
    system: T[l].system,
    user: `${contextBlock(l, answers)}\n\n${T[l].branchTask(QUESTIONS[l][branch], answers[branch] || '', existing)}`,
    temperature: 0.8,
  };
}

function wordExpansion({ language, branch, seed, answers, existing = [] }) {
  const l = lang(language);
  return {
    system: T[l].system,
    user: `${contextBlock(l, answers)}\n\n${T[l].wordTask(QUESTIONS[l][branch], seed, existing)}`,
    temperature: 0.8,
  };
}

// idWords: [{ id: 'w1', branch, text }]
function creativeAcronyms({ language, answers, idWords, minLength, maxLength, maxPerBranch = 1 }) {
  const l = lang(language);
  const groups = BRANCHES.map((b) => {
    const list = idWords.filter((w) => w.branch === b).map((w) => `${w.id}: ${w.text}`);
    return list.length ? `[${T[l].branchNames[b]}]\n${list.join('\n')}` : '';
  }).filter(Boolean);
  return {
    system: T[l].system,
    user: `${contextBlock(l, answers)}\n\n${groups.join('\n\n')}\n\n${T[l].creativeTask(minLength, maxLength, maxPerBranch)}`,
    temperature: 0.8,
  };
}

// candidates: [{ letters, parts: [{ text, letters }] }]
function rankAcronyms({ language, answers, candidates }) {
  const l = lang(language);
  const lines = candidates.map((c) => `${c.letters} = ${c.parts.map((p) => p.text).join(' · ')}`);
  return {
    system: T[l].system,
    user: `${contextBlock(l, answers)}\n\n${T[l].rankTask}\n\n${lines.join('\n')}`,
    temperature: 0.3,
  };
}

module.exports = { BRANCHES, QUESTIONS, branchExpansion, wordExpansion, creativeAcronyms, rankAcronyms };
