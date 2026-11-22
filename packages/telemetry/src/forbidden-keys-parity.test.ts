// The leak scan of the trace scenarios checks the forbidden keys of the acceptance support code (a copy). This test keeps
// that copy equal to the telemetry package's list, so the scan and the exporters strip the same keys (OBS-28).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_WORDS, PERSONAL_WORDS, STAGING_ONLY_KEYS } from './redact-attributes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const acceptanceKeys = readFileSync(
  path.resolve(here, '..', '..', '..', 'tests', 'acceptance', 'support', 'forbidden-keys.ts'),
  'utf8',
);

/** The quoted words of the named list in the acceptance copy. */
function acceptanceWords(source: string, list: string): string[] {
  const listed = new RegExp(`${list}[^=]*=\\s*\\[([^\\]]*)\\]`, 'u').exec(source)?.[1] ?? '';
  return [...listed.matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '').sort();
}

describe('forbidden keys of the acceptance code', () => {
  it('the credential, personal and staging-only lists of the acceptance code and the telemetry package are equal', () => {
    const credential = acceptanceWords(acceptanceKeys, 'FORBIDDEN_KEY_WORDS');
    expect(credential.length).toBeGreaterThan(0);
    expect(credential).toStrictEqual([...CREDENTIAL_WORDS].sort());
    expect(acceptanceWords(acceptanceKeys, 'PERSONAL_KEY_WORDS')).toStrictEqual([...PERSONAL_WORDS].sort());
    expect(acceptanceWords(acceptanceKeys, 'STAGING_ONLY_KEYS')).toStrictEqual([...STAGING_ONLY_KEYS].sort());
  });
});
