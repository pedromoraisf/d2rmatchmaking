// Attribute redaction and text scrubbing (OBS-28, OBS-29). Pure functions: the redacting exporters and the
// log exporter call them; nothing here reads a clock, the environment or the network.
import type { AttributeValue, Attributes } from '@opentelemetry/api';

// Credentials, secrets, images and player identifiers. A key is forbidden when the whole key, or one hyphen-separated
// word of its last dot segment, is one of these words (case-insensitive). So `pairing.code`, `x-token` and
// `http.request.header.authorization` go, while `http.response.status_code` (segment `status_code`) and `db.statement`
// stay.
const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'code',
  'secret',
  'password',
  'image',
  'battletag',
]);

// Keys whose value may carry a query string or a fragment; only the part before `?` or `#` is kept.
const URL_KEYS: ReadonlySet<string> = new Set(['url.full', 'http.url', 'http.target', 'url.query']);

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  const lastSegment = lower.slice(lower.lastIndexOf('.') + 1);
  if (FORBIDDEN_WORDS.has(lower) || FORBIDDEN_WORDS.has(lastSegment)) return true;
  return lastSegment.split('-').some((word) => FORBIDDEN_WORDS.has(word));
}

function isDroppedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    isForbiddenKey(key) ||
    lower === 'client.address' ||
    lower === 'user_agent.original' ||
    lower.startsWith('enduser.')
  );
}

function withoutQueryOrFragment(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? '';
}

/** Returns a copy of `attributes` with forbidden keys dropped and URL query strings and fragments removed. */
export function redactAttributes(attributes: Attributes): Attributes {
  const redacted: Record<string, AttributeValue | undefined> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isDroppedKey(key)) continue;
    const isUrl = URL_KEYS.has(key.toLowerCase());
    redacted[key] = isUrl && typeof value === 'string' ? withoutQueryOrFragment(value) : value;
  }
  return redacted;
}

// Each rule replaces a secret with `[redacted]` and keeps the key that names it, so the text stays readable.
const SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/(__Host-d2rmm_session=)[^;\s]+/g, '$1[redacted]'],
  [/\b(code|token)=[^&\s;]+/gi, '$1=[redacted]'],
  [/("(?:token|secret|password|code|authorization|cookie)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2'],
  [/\((battletag)\)=\([^)]*\)/gi, '($1)=([redacted])'],
];

/** Replaces bearer tokens, the session cookie, `code=`/`token=` pairs, JSON-shaped secrets and battletag values. */
export function scrubText(text: string): string {
  return SCRUB_RULES.reduce(
    (scrubbed, [pattern, replacement]) => scrubbed.replace(pattern, replacement),
    text,
  );
}
