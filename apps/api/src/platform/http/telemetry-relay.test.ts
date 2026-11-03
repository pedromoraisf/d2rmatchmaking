// The relay's body decision (OBS-13, OBS-20; design § Relay route): the media type, the content encoding and the declared
// length, decided before Fastify reads the body. Pure: the route only maps the answer to its reply.
import { describe, expect, it } from 'vitest';
import { bodyRefusal, RELAY_BODY_LIMIT_BYTES } from './telemetry-relay.ts';

const MIB = 1024 * 1024;

describe('bodyRefusal', () => {
  it('accepts a body of exactly 1 MiB', () => {
    expect(RELAY_BODY_LIMIT_BYTES).toBe(MIB);
    expect(
      bodyRefusal({
        contentType: 'application/json',
        contentEncoding: undefined,
        contentLength: String(MIB),
      }),
    ).toBeUndefined();
  });

  it('refuses a declared body of 1 MiB plus one byte with 413', () => {
    expect(
      bodyRefusal({
        contentType: 'application/json',
        contentEncoding: undefined,
        contentLength: String(MIB + 1),
      }),
    ).toBe(413);
  });

  it('accepts a media type in mixed case with a charset parameter', () => {
    expect(
      bodyRefusal({
        contentType: 'Application/JSON; charset=utf-8',
        contentEncoding: undefined,
        contentLength: undefined,
      }),
    ).toBeUndefined();
  });

  it('accepts application/x-protobuf', () => {
    expect(
      bodyRefusal({ contentType: 'application/x-protobuf', contentEncoding: undefined, contentLength: '12' }),
    ).toBeUndefined();
  });

  it('refuses text/plain with 415', () => {
    expect(bodyRefusal({ contentType: 'text/plain', contentEncoding: undefined, contentLength: '2' })).toBe(
      415,
    );
  });

  it('refuses a missing content type with 415', () => {
    expect(bodyRefusal({ contentType: undefined, contentEncoding: undefined, contentLength: '2' })).toBe(415);
  });

  it('refuses gzip with 415', () => {
    expect(
      bodyRefusal({ contentType: 'application/json', contentEncoding: 'gzip', contentLength: '2' }),
    ).toBe(415);
  });

  it('accepts the identity encoding in any case', () => {
    expect(
      bodyRefusal({ contentType: 'application/json', contentEncoding: 'IDENTITY', contentLength: '2' }),
    ).toBeUndefined();
  });

  it('answers 415 for a bad media type with an oversized body', () => {
    expect(
      bodyRefusal({ contentType: 'text/plain', contentEncoding: undefined, contentLength: String(MIB + 1) }),
    ).toBe(415);
  });
});
