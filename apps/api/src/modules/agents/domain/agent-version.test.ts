import { describe, expect, it } from 'vitest';
import { AgentVersion } from './agent-version.ts';

function parsed(raw: string): AgentVersion {
  const result = AgentVersion.parse(raw);
  if (!result.ok) {
    throw new Error(`fixture version ${raw} is invalid`);
  }
  return result.value;
}

describe('AgentVersion.parse', () => {
  it('rejects a version that is not semantic', () => {
    for (const raw of ['1.0', 'v1.0.0', '']) {
      expect(AgentVersion.parse(raw)).toEqual({ ok: false, error: 'invalid-version' });
    }
  });

  it('accepts a strict major.minor.patch version', () => {
    expect(AgentVersion.parse('0.0.1').ok).toBe(true);
  });
});

describe('AgentVersion.isBelow', () => {
  it('0.0.1 is not below 0.0.0', () => {
    expect(parsed('0.0.1').isBelow(parsed('0.0.0'))).toBe(false);
  });

  it('0.0.9 is below 0.1.0 (numeric, not lexical)', () => {
    expect(parsed('0.0.9').isBelow(parsed('0.1.0'))).toBe(true);
  });

  it('10.0.0 is not below 9.9.9 (numeric, not lexical)', () => {
    expect(parsed('10.0.0').isBelow(parsed('9.9.9'))).toBe(false);
  });

  it('a version equal to the minimum is not below it', () => {
    expect(parsed('1.2.3').isBelow(parsed('1.2.3'))).toBe(false);
  });
});

describe('AgentVersion components', () => {
  it('reads the patch number as a whole number, not its last digit', () => {
    const parsedVersion = AgentVersion.parse('0.1.10');

    expect(parsedVersion).toMatchObject({ ok: true, value: { major: 0, minor: 1, patch: 10 } });
  });

  it('rejects a prerelease suffix or a fourth part', () => {
    for (const raw of ['1.2.3-beta', '1.2.3.4']) {
      expect(AgentVersion.parse(raw)).toEqual({ ok: false, error: 'invalid-version' });
    }
  });

  it('compares the major number first, even when the minor and patch of the other side are higher', () => {
    expect(parsed('1.0.0').isBelow(parsed('0.5.0'))).toBe(false);
    expect(parsed('0.5.0').isBelow(parsed('1.0.0'))).toBe(true);
    expect(parsed('0.9.9').isBelow(parsed('1.0.0'))).toBe(true);
  });
});
