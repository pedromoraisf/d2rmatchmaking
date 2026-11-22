// The forbidden keys of the telemetry package (packages/telemetry/src/redact-attributes.ts), copied here so the leak scan of
// the trace scenarios checks the keys the exporters strip. The parity test in packages/telemetry keeps the word list equal
// to the package's FORBIDDEN_WORDS; the rules below repeat the package's `isDroppedKey` and must change with it.

export const FORBIDDEN_KEY_WORDS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'code',
  'secret',
  'password',
  'image',
];

// Words that name a person, and the keys only the full tier carries (ADR 037). Production drops both.
export const PERSONAL_KEY_WORDS: readonly string[] = ['battletag'];

export const STAGING_ONLY_KEYS: readonly string[] = [
  'd2r.account.battletag',
  'd2r.character.name',
  'd2r.observation.read_text',
  'd2r.observation.read_names',
  'd2r.ocr.text',
  'd2r.ocr.names',
];

export type Tier = 'full' | 'production';

const WORDS: ReadonlySet<string> = new Set(FORBIDDEN_KEY_WORDS);
const PERSONAL: ReadonlySet<string> = new Set(PERSONAL_KEY_WORDS);
const STAGING_ONLY: ReadonlySet<string> = new Set(STAGING_ONLY_KEYS);

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

/**
 * True for a key the telemetry package drops in `tier`: a credential, a client or peer address, a user agent or an end
 * user in both tiers; a personal word or a staging-only key in production.
 */
export function isDroppedKey(key: string, tier: Tier = 'production'): boolean {
  const lower = key.toLowerCase();
  if (
    hasWord(key, WORDS) ||
    PEER_KEYS.has(lower) ||
    lower === 'user_agent.original' ||
    lower.startsWith('enduser.')
  ) {
    return true;
  }
  return tier === 'production' && (hasWord(key, PERSONAL) || STAGING_ONLY.has(lower));
}
