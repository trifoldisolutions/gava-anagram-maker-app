const STATUS = {
  llm_unavailable: 503,
  llm_timeout: 504,
  llm_error: 502,
  invalid_json: 502,
};

class LLMError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'LLMError';
    this.code = code;
    this.status = STATUS[code] || 502;
  }
}

module.exports = { LLMError };
