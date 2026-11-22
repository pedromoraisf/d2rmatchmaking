// Attribute redaction and text scrubbing (OBS-28, OBS-29). Pure functions: the redacting exporters and the
// log exporter call them; nothing here reads a clock, the environment or the network.
import type { AttributeValue, Attributes } from '@opentelemetry/api';

/** The two detail tiers of ADR 037: `full` (staging, previews, development) and `production`. */
export type TelemetryTier = 'full' | 'production';

/** Maps a tier name to a tier. Anything but `full` is `production`: the stricter tier is the safe failure (OBT-01). */
export function tierFrom(value: string | undefined): TelemetryTier {
  return value === 'full' ? 'full' : 'production';
}

// Credentials, secrets and images. Dropped in every tier (OBT-11). A key is forbidden when the whole key, or one
// hyphen-separated word of its last dot segment, is one of these words (case-insensitive). So `pairing.code`, `x-token`
// and `http.request.header.authorization` go, while `http.response.status_code` (segment `status_code`) and
// `db.statement` stay.
export const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'code',
  'secret',
  'password',
  'image',
]);

// Words that name a person. Dropped in production only (ADR 037): the full tier keeps the BattleTag.
export const PERSONAL_WORDS: ReadonlySet<string> = new Set(['battletag']);

// Keys only the full tier carries (OBT-04, OBT-06, OBT-07): the player's identity and the text read from the screen.
// Production drops each one before export, wherever a library or a caller put it.
export const STAGING_ONLY_KEYS: ReadonlySet<string> = new Set([
  'd2r.account.battletag',
  'd2r.character.name',
  'd2r.observation.read_text',
  'd2r.observation.read_names',
  'd2r.ocr.text',
  'd2r.ocr.names',
]);

// Keys whose value may carry a query string or a fragment; only the part before `?` or `#` is kept.
const URL_KEYS: ReadonlySet<string> = new Set(['url.full', 'http.url', 'http.target', 'url.query']);

function hasWord(key: string, words: ReadonlySet<string>): boolean {
  const lower = key.toLowerCase();
  const lastSegment = lower.slice(lower.lastIndexOf('.') + 1);
  if (words.has(lower) || words.has(lastSegment)) return true;
  return lastSegment.split('-').some((word) => words.has(word));
}

// The socket address of the caller: `instrumentation-http` sets `network.peer.*` on every server span (AD-107).
const PEER_KEYS: ReadonlySet<string> = new Set([
  'client.address',
  'network.peer.address',
  'network.peer.port',
]);

/** True when the tier drops the key before export: credentials and peers always, personal and staging-only in production. */
export function isDroppedKey(key: string, tier: TelemetryTier): boolean {
  const lower = key.toLowerCase();
  if (
    hasWord(key, CREDENTIAL_WORDS) ||
    PEER_KEYS.has(lower) ||
    lower === 'user_agent.original' ||
    lower.startsWith('enduser.')
  ) {
    return true;
  }
  return tier === 'production' && (hasWord(key, PERSONAL_WORDS) || STAGING_ONLY_KEYS.has(lower));
}

function withoutQueryOrFragment(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? '';
}

/**
 * Returns a copy of `attributes` with the keys the tier forbids dropped and URL query strings and fragments removed.
 * Credentials go in both tiers; staging-only keys and personal words go in production (OBT-08, OBT-11).
 */
export function redactForTier(attributes: Attributes, tier: TelemetryTier): Attributes {
  const redacted: Record<string, AttributeValue | undefined> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isDroppedKey(key, tier)) continue;
    const isUrl = URL_KEYS.has(key.toLowerCase());
    redacted[key] = isUrl && typeof value === 'string' ? withoutQueryOrFragment(value) : value;
  }
  return redacted;
}

// Each rule replaces a secret with `[redacted]` and keeps the key that names it, so the text stays readable.
const CREDENTIAL_SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/(__Host-d2rmm_session=)[^;\s]+/g, '$1[redacted]'],
  [/\b(code|token)=[^&\s;]+/gi, '$1=[redacted]'],
  [/("(?:token|secret|password|code|authorization|cookie)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2'],
];

// A database error detail holds the value of the unique key that failed; production removes a BattleTag from it.
const PERSONAL_SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\((battletag)\)=\([^)]*\)/gi, '($1)=([redacted])'],
];

/**
 * Replaces bearer tokens, the session cookie, `code=`/`token=` pairs and JSON-shaped secrets in every tier, and
 * battletag values in production.
 */
export function scrubText(text: string, tier: TelemetryTier): string {
  const rules =
    tier === 'production' ? [...CREDENTIAL_SCRUB_RULES, ...PERSONAL_SCRUB_RULES] : CREDENTIAL_SCRUB_RULES;
  return rules.reduce((scrubbed, [pattern, replacement]) => scrubbed.replace(pattern, replacement), text);
}
