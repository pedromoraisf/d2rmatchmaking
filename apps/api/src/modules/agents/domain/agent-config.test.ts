import { describe, expect, it } from 'vitest';
import { etagOf, matchesEtag, servedConfigOf } from './agent-config.ts';

describe('etagOf', () => {
  it('names the version and the content digest in a quoted strong validator', () => {
    expect(etagOf(1, 'aaaaaaaaaaaaaaaa')).toBe('"agent-config-v1-aaaaaaaaaaaaaaaa"');
    expect(etagOf(42, '0123456789abcdef')).toBe('"agent-config-v42-0123456789abcdef"');
  });

  it('differs for each version and for each content of one version', () => {
    expect(etagOf(1, 'aaaaaaaaaaaaaaaa')).not.toBe(etagOf(2, 'aaaaaaaaaaaaaaaa'));
    // A file edited without a version bump is another tag: no agent holding the old bytes is told "not modified".
    expect(etagOf(1, 'aaaaaaaaaaaaaaaa')).not.toBe(etagOf(1, 'bbbbbbbbbbbbbbbb'));
  });
});

describe('servedConfigOf', () => {
  it('binds the bytes to the version and its tag', () => {
    expect(servedConfigOf(3, '{"version":3}', '0123456789abcdef')).toStrictEqual({
      version: 3,
      body: '{"version":3}',
      etag: '"agent-config-v3-0123456789abcdef"',
    });
  });
});

describe('matchesEtag', () => {
  const etag = etagOf(2, 'aaaaaaaaaaaaaaaa');

  it('matches the tag itself, a weak form of it, a list holding it and the wildcard', () => {
    expect(matchesEtag(etag, etag)).toBe(true);
    expect(matchesEtag(`W/${etag}`, etag)).toBe(true);
    expect(matchesEtag(`"other", ${etag}`, etag)).toBe(true);
    expect(matchesEtag('*', etag)).toBe(true);
  });

  it('does not match another version, an absent header or an empty one', () => {
    expect(matchesEtag(etagOf(1, 'aaaaaaaaaaaaaaaa'), etag)).toBe(false);
    expect(matchesEtag(etagOf(2, 'bbbbbbbbbbbbbbbb'), etag)).toBe(false);
    expect(matchesEtag(undefined, etag)).toBe(false);
    expect(matchesEtag('', etag)).toBe(false);
    expect(matchesEtag('"agent-config-v2', etag)).toBe(false);
  });

  it('drops the weak mark only at the start of a tag, never from inside it', () => {
    expect(matchesEtag('"xW/y"', '"xW/y"')).toBe(true);
    expect(matchesEtag('"xW/y"', '"xy"')).toBe(false);
  });
});
