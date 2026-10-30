// Placeholder documents (HF-04). api-web-skeleton replaces this file with generation from Zod schemas and Fastify
// routes (ADR 009, ADR 020). Do not extend it by hand.

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, never>;
}

export interface AsyncApiDocument {
  asyncapi: '3.0.0';
  info: { title: string; version: string };
  channels: Record<string, never>;
}

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: { title: 'D2R Match Making API', version: '0.0.0' },
    paths: {},
  };
}

export function buildAsyncApiDocument(): AsyncApiDocument {
  return {
    asyncapi: '3.0.0',
    info: { title: 'D2R Match Making events', version: '0.0.0' },
    channels: {},
  };
}
