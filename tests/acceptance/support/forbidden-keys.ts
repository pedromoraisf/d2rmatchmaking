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
  'battletag',
];

const WORDS: ReadonlySet<string> = new Set(FORBIDDEN_KEY_WORDS);

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  const lastSegment = lower.slice(lower.lastIndexOf('.') + 1);
  if (WORDS.has(lower) || WORDS.has(lastSegment)) return true;
  return lastSegment.split('-').some((word) => WORDS.has(word));
}

// The socket address of the caller: `instrumentation-http` sets `network.peer.*` on every server span (AD-107).
const PEER_KEYS: ReadonlySet<string> = new Set([
  'client.address',
  'network.peer.address',
  'network.peer.port',
]);

/** True for a key the telemetry package drops: a forbidden key, a client or peer address, a user agent or an end user. */
export function isDroppedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    isForbiddenKey(key) ||
    PEER_KEYS.has(lower) ||
    lower === 'user_agent.original' ||
    lower.startsWith('enduser.')
  );
}
