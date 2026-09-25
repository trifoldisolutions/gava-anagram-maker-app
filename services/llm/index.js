// Provider-agnostic LLM facade. Add a provider as services/llm/<name>.js exposing
// listModels(), ping(), chat({ model, messages, temperature }) → string, warmup(model).
const { LLMError } = require('./errors');

const providerName = () => (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
const defaultModel = () => process.env.OLLAMA_MODEL || 'huihui_ai/gemma-4-abliterated:12b';

const NOT_PROVIDERS = new Set(['index', 'errors', 'prompts']);

function provider() {
  if (NOT_PROVIDERS.has(providerName())) throw new LLMError('llm_unavailable', 'Invalid LLM_PROVIDER');
  try {
    return require(`./${providerName()}`);
  } catch {
    throw new LLMError('llm_unavailable', `Unknown LLM provider "${providerName()}"`);
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch { /* fall through */ }
  }
  return undefined;
}

async function listModels() {
  return provider().listModels();
}

async function isAvailable() {
  try {
    return await provider().ping();
  } catch {
    return false;
  }
}

async function chatJSON({ model, system, user, temperature = 0.7 }) {
  const p = provider();
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user },
  ];
  const first = parseJSON(await p.chat({ model: model || defaultModel(), messages, temperature }));
  if (first && typeof first === 'object') return first;

  const retry = [...messages, { role: 'user', content: 'Return only valid JSON. No prose, no markdown.' }];
  const second = parseJSON(await p.chat({ model: model || defaultModel(), messages: retry, temperature }));
  if (second && typeof second === 'object') return second;
  throw new LLMError('invalid_json', 'The model did not return valid JSON');
}

async function warmup(model) {
  return provider().warmup(model || defaultModel());
}

module.exports = { listModels, isAvailable, chatJSON, warmup, defaultModel, providerName, LLMError };
