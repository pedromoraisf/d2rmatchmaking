import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_WORDS,
  PERSONAL_WORDS,
  STAGING_ONLY_KEYS,
  redactForTier,
  scrubText,
  tierFrom,
} from './redact-attributes.ts';

describe('redactForTier', () => {
  it('strips every forbidden key and keeps the allowed ones', () => {
    const redacted = redactForTier(
      {
        authorization: 'Bearer abc',
        Authorization: 'Bearer abc',
        'http.request.header.authorization': 'Bearer abc',
        'http.request.header.cookie': '__Host-d2rmm_session=abc',
        'set-cookie': 'x=1',
        token: 'abc',
        Token: 'abc',
        code: '1234',
        'pairing.code': 'ABCD',
        secret: 'shh',
        password: 'pw',
        image: 'data:image/png',
        battletag: 'Foo#1234',
        'x-token': 'abc',
        'http.response.status_code': 200,
        'db.statement': 'select $1 from lobby.rooms',
        'd2r.room.id': 'room-1',
      },
      'production',
    );

    expect(redacted).toStrictEqual({
      'http.response.status_code': 200,
      'db.statement': 'select $1 from lobby.rooms',
      'd2r.room.id': 'room-1',
    });
  });

  it('removes the query string and the fragment from url attributes and drops the client address', () => {
    const redacted = redactForTier(
      {
        'url.full': 'https://d2rmm.example/api/v1/agents?code=1#frag',
        'http.url': 'https://d2rmm.example/api/v1/lobby?token=2',
        'http.target': '/api/v1/lobby?room=mm1-2',
        'url.query': 'room=mm1-2#frag',
        'client.address': '203.0.113.7',
        'network.peer.address': '203.0.113.7',
        'network.peer.port': 51234,
        'user_agent.original': 'Mozilla/5.0',
        'enduser.id': 'account-1',
        'enduser.name': 'Player',
        'http.route': '/api/v1/lobby',
      },
      'production',
    );

    expect(redacted).toStrictEqual({
      'url.full': 'https://d2rmm.example/api/v1/agents',
      'http.url': 'https://d2rmm.example/api/v1/lobby',
      'http.target': '/api/v1/lobby',
      'url.query': 'room=mm1-2',
      'http.route': '/api/v1/lobby',
    });
  });
});

describe('scrubText', () => {
  it('scrubs plain and json shaped secrets from text', () => {
    expect(scrubText('Authorization: Bearer abc.DEF-123', 'production')).toBe(
      'Authorization: Bearer [redacted]',
    );
    expect(scrubText('cookie: __Host-d2rmm_session=s3cr3t; Path=/', 'production')).toBe(
      'cookie: __Host-d2rmm_session=[redacted]; Path=/',
    );
    expect(scrubText('GET /v1/x?code=abc123&token=xyz', 'production')).toBe(
      'GET /v1/x?code=[redacted]&token=[redacted]',
    );
    expect(scrubText('{"token":"abc123","room":"mm1-2"}', 'production')).toBe(
      '{"token":"[redacted]","room":"mm1-2"}',
    );
    expect(scrubText('DETAIL:  Key (battletag)=(Foo#1234) already exists.', 'production')).toBe(
      'DETAIL:  Key (battletag)=([redacted]) already exists.',
    );
  });
});

const STAGING_ONLY_VALUES: Record<string, string | string[]> = {
  'd2r.account.battletag': 'Foo#1234',
  'd2r.character.name': 'Sorc',
  'd2r.observation.read_text': 'Party Sorc',
  'd2r.observation.read_names': ['Sorc', 'Pala'],
  'd2r.ocr.text': 'DUEL NK LOCKS',
  'd2r.ocr.names': ['Sorc'],
};

describe('tiers (OBT-08, OBT-11)', () => {
  it('lists the staging-only keys the specification names', () => {
    expect([...STAGING_ONLY_KEYS].sort()).toStrictEqual(Object.keys(STAGING_ONLY_VALUES).sort());
  });

  it.each(Object.entries(STAGING_ONLY_VALUES))(
    'drops %s in production and keeps it in full',
    (key, value) => {
      expect(redactForTier({ [key]: value, 'd2r.room.id': 'room-1' }, 'production')).toStrictEqual({
        'd2r.room.id': 'room-1',
      });
      expect(redactForTier({ [key]: value, 'd2r.room.id': 'room-1' }, 'full')).toStrictEqual({
        [key]: value,
        'd2r.room.id': 'room-1',
      });
    },
  );

  it('drops a personal word under any key in production and keeps it in full', () => {
    const attributes = { 'x.battletag': 'Foo#1234', 'player-battletag': 'Foo#1234', 'd2r.room.id': 'r' };
    expect(redactForTier(attributes, 'production')).toStrictEqual({ 'd2r.room.id': 'r' });
    expect(redactForTier(attributes, 'full')).toStrictEqual(attributes);
  });

  it.each([...CREDENTIAL_WORDS])('drops the credential word %s in both tiers', (word) => {
    for (const tier of ['production', 'full'] as const) {
      expect(
        redactForTier({ [word]: 'secret-value', [`http.${word}`]: 'v', 'd2r.room.id': 'r' }, tier),
      ).toStrictEqual({ 'd2r.room.id': 'r' });
    }
  });

  it('drops the caller address, the user agent and the end user in both tiers', () => {
    for (const tier of ['production', 'full'] as const) {
      expect(
        redactForTier(
          {
            'client.address': '1.2.3.4',
            'network.peer.address': '1.2.3.4',
            'user_agent.original': 'x',
            'enduser.id': 'a',
          },
          tier,
        ),
      ).toStrictEqual({});
    }
  });

  it('keeps the personal words out of the credential list and the credential words out of the personal list', () => {
    expect([...PERSONAL_WORDS]).toStrictEqual(['battletag']);
    expect(CREDENTIAL_WORDS.has('battletag')).toBe(false);
  });

  it('scrubs a battletag from text in production only, and credentials in both', () => {
    const detail = 'Key (battletag)=(Foo#1234) already exists. code=abc';
    expect(scrubText(detail, 'production')).toBe(
      'Key (battletag)=([redacted]) already exists. code=[redacted]',
    );
    expect(scrubText(detail, 'full')).toBe('Key (battletag)=(Foo#1234) already exists. code=[redacted]');
  });

  it('maps only the exact name full to the full tier (OBT-01)', () => {
    expect(tierFrom('full')).toBe('full');
    for (const unknown of [undefined, '', 'production', 'FULL', 'staging', 'x']) {
      expect(tierFrom(unknown)).toBe('production');
    }
  });
});
