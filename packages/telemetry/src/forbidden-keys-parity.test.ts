// The leak scan of the trace scenarios checks the forbidden keys of the acceptance support code (a copy). This test keeps
// that copy equal to the telemetry package's list, so the scan and the exporters strip the same keys (OBS-28).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_WORDS } from './redact-attributes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const acceptanceKeys = readFileSync(
  path.resolve(here, '..', '..', '..', 'tests', 'acceptance', 'support', 'forbidden-keys.ts'),
  'utf8',
);

/** The quoted words of the `FORBIDDEN_KEY_WORDS` list in the acceptance copy. */
function acceptanceWords(source: string): string[] {
  const listed = /FORBIDDEN_KEY_WORDS[^=]*=\s*\[([^\]]*)\]/u.exec(source)?.[1] ?? '';
  return [...listed.matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '').sort();
}

describe('forbidden keys of the acceptance code', () => {
  it('the forbidden key lists of the acceptance code and the telemetry package are equal', () => {
    const words = acceptanceWords(acceptanceKeys);
    expect(words.length).toBeGreaterThan(0);
    expect(words).toStrictEqual([...FORBIDDEN_WORDS].sort());
  });
});
