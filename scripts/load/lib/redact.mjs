// Masks secret text in a string: cookies, bearer tokens, agent tokens, passwords and URL user-info (AGENTS.md rule 6;
// design.md § Work directory and credentials). Pure: text in, text out. The summary and the preflight use it; the
// orchestrator's log redactor uses the same rules.

const RULES = [
  [/\b(Set-Cookie|Cookie)(\s*:\s*)[^\r\n]*/gi, '$1$2[redacted]'],
  [/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]'],
  [/__Host-d2rmm_session=[^\s;"',]+/g, '__Host-d2rmm_session=[redacted]'],
  [/\bd2rmm_a_[^\s"',;]+/g, '[redacted]'],
  [/\b(password|passwd|pwd|claimSecret|secret|token)(["']?\s*[=:]\s*["']?)[^\s"',;&]+/gi, '$1$2[redacted]'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@'],
];

/**
 * The text with every secret it carries masked.
 * @param {string} text
 * @returns {string}
 */
export function redact(text) {
  return RULES.reduce((masked, [pattern, replacement]) => masked.replace(pattern, replacement), String(text));
}

/**
 * True when the text carries secret text that `redact` would mask.
 * @param {string} text
 * @returns {boolean}
 */
export function containsSecret(text) {
  const plain = String(text);
  return redact(plain) !== plain;
}
