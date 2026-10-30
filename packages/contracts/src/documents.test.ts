import { describe, expect, it } from 'vitest';
import { buildAsyncApiDocument, buildOpenApiDocument } from './documents.ts';

describe('contract documents', () => {
  it('builds an OpenAPI 3.1 document with no paths', () => {
    expect(buildOpenApiDocument()).toStrictEqual({
      openapi: '3.1.0',
      info: { title: 'D2R Match Making API', version: '0.0.0' },
      paths: {},
    });
  });

  it('builds an AsyncAPI 3.0 document with no channels', () => {
    expect(buildAsyncApiDocument()).toStrictEqual({
      asyncapi: '3.0.0',
      info: { title: 'D2R Match Making events', version: '0.0.0' },
      channels: {},
    });
  });

  it('returns equal documents on every call', () => {
    expect(buildOpenApiDocument()).toStrictEqual(buildOpenApiDocument());
    expect(buildAsyncApiDocument()).toStrictEqual(buildAsyncApiDocument());
  });
});
