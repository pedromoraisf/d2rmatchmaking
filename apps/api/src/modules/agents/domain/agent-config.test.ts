import { describe, expect, it } from 'vitest';
import { etagOf, matchesEtag, servedConfigOf } from './agent-config.ts';

describe('etagOf', () => {
  it('names the version in a quoted strong validator', () => {
    expect(etagOf(1)).toBe('"agent-config-v1"');
    expect(etagOf(42)).toBe('"agent-config-v42"');
  });

  it('differs for each version', () => {
    expect(etagOf(1)).not.toBe(etagOf(2));
  });
});

describe('servedConfigOf', () => {
  it('binds the bytes to the version and its tag', () => {
    expect(servedConfigOf(3, '{"version":3}')).toStrictEqual({
      version: 3,
      body: '{"version":3}',
      etag: '"agent-config-v3"',
    });
  });
});

describe('matchesEtag', () => {
  const etag = etagOf(2);

  it('matches the tag itself, a weak form of it, a list holding it and the wildcard', () => {
    expect(matchesEtag(etag, etag)).toBe(true);
    expect(matchesEtag(`W/${etag}`, etag)).toBe(true);
    expect(matchesEtag(`"other", ${etag}`, etag)).toBe(true);
    expect(matchesEtag('*', etag)).toBe(true);
  });

  it('does not match another version, an absent header or an empty one', () => {
    expect(matchesEtag(etagOf(1), etag)).toBe(false);
    expect(matchesEtag(undefined, etag)).toBe(false);
    expect(matchesEtag('', etag)).toBe(false);
    expect(matchesEtag('"agent-config-v2', etag)).toBe(false);
  });
});
