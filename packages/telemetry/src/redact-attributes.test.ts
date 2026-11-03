import { describe, expect, it } from 'vitest';
import { redactAttributes, scrubText } from './redact-attributes.ts';

describe('redactAttributes', () => {
  it('strips every forbidden key and keeps the allowed ones', () => {
    const redacted = redactAttributes({
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
    });

    expect(redacted).toStrictEqual({
      'http.response.status_code': 200,
      'db.statement': 'select $1 from lobby.rooms',
      'd2r.room.id': 'room-1',
    });
  });

  it('removes the query string and the fragment from url attributes and drops the client address', () => {
    const redacted = redactAttributes({
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
    });

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
    expect(scrubText('Authorization: Bearer abc.DEF-123')).toBe('Authorization: Bearer [redacted]');
    expect(scrubText('cookie: __Host-d2rmm_session=s3cr3t; Path=/')).toBe(
      'cookie: __Host-d2rmm_session=[redacted]; Path=/',
    );
    expect(scrubText('GET /v1/x?code=abc123&token=xyz')).toBe('GET /v1/x?code=[redacted]&token=[redacted]');
    expect(scrubText('{"token":"abc123","room":"mm1-2"}')).toBe('{"token":"[redacted]","room":"mm1-2"}');
    expect(scrubText('DETAIL:  Key (battletag)=(Foo#1234) already exists.')).toBe(
      'DETAIL:  Key (battletag)=([redacted]) already exists.',
    );
  });
});
