import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase } from '../app.ts';
import { OPENAPI_PATH, buildOpenApiText } from '../openapi.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

/** Every route buildApp registers with staging on, in Fastify's route syntax (`:id`) and the document's (`{id}`). */
const ROUTES: readonly {
  readonly method: 'get' | 'post' | 'patch' | 'delete';
  readonly url: string;
  readonly path: string;
}[] = [
  { method: 'get', url: '/healthz', path: '/healthz' },
  { method: 'get', url: '/v1/config', path: '/v1/config' },
  { method: 'post', url: '/v1/auth/test-login', path: '/v1/auth/test-login' },
  { method: 'get', url: '/v1/auth/bnet/login', path: '/v1/auth/bnet/login' },
  { method: 'get', url: '/v1/auth/bnet/callback', path: '/v1/auth/bnet/callback' },
  { method: 'post', url: '/v1/auth/logout', path: '/v1/auth/logout' },
  { method: 'get', url: '/v1/me', path: '/v1/me' },
  { method: 'post', url: '/v1/me/characters', path: '/v1/me/characters' },
  { method: 'get', url: '/v1/me/characters', path: '/v1/me/characters' },
  { method: 'patch', url: '/v1/me/characters/:id', path: '/v1/me/characters/{id}' },
  { method: 'post', url: '/v1/agents/pairing-codes', path: '/v1/agents/pairing-codes' },
  { method: 'post', url: '/v1/agents/pairing-codes/claim', path: '/v1/agents/pairing-codes/claim' },
  { method: 'post', url: '/v1/agents/pair', path: '/v1/agents/pair' },
  { method: 'post', url: '/v1/agents/heartbeat', path: '/v1/agents/heartbeat' },
  { method: 'get', url: '/v1/agents/me', path: '/v1/agents/me' },
  { method: 'get', url: '/v1/agents/me/assignment', path: '/v1/agents/me/assignment' },
  { method: 'delete', url: '/v1/agents/:id', path: '/v1/agents/{id}' },
  { method: 'post', url: '/v1/lobby-rooms/:id/observations', path: '/v1/lobby-rooms/{id}/observations' },
  { method: 'post', url: '/v1/lobby-rooms/:id/runs', path: '/v1/lobby-rooms/{id}/runs' },
  { method: 'post', url: '/v1/lobby-rooms/:id/leave', path: '/v1/lobby-rooms/{id}/leave' },
  { method: 'post', url: '/v1/lobby-rooms/:id/close', path: '/v1/lobby-rooms/{id}/close' },
  { method: 'get', url: '/v1/me/room', path: '/v1/me/room' },
  { method: 'post', url: '/v1/staging/match-formed', path: '/v1/staging/match-formed' },
  { method: 'post', url: '/v1/queue/tickets', path: '/v1/queue/tickets' },
  { method: 'get', url: '/v1/queue/tickets/me', path: '/v1/queue/tickets/me' },
  { method: 'delete', url: '/v1/queue/tickets/:id', path: '/v1/queue/tickets/{id}' },
  { method: 'get', url: '/v1/ready-checks/me', path: '/v1/ready-checks/me' },
  { method: 'post', url: '/v1/ready-checks/:id/accept', path: '/v1/ready-checks/{id}/accept' },
  { method: 'post', url: '/v1/ready-checks/:id/decline', path: '/v1/ready-checks/{id}/decline' },
  { method: 'post', url: '/v1/telemetry/traces', path: '/v1/telemetry/traces' },
  { method: 'get', url: '/v1/stream', path: '/v1/stream' },
];

type Operation = { readonly requestBody?: unknown; readonly responses?: Record<string, unknown> };
type Document = { readonly paths: Record<string, Record<string, Operation>> };

const silent = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

describe('openapi document', () => {
  it('openapi.json lists every route', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const db = new Kysely<AppDatabase>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ connectionString: 'postgres://unused.invalid/none' }),
      }),
    });
    const built = await buildApp({
      db,
      config: {
        stagingEndpoints: true,
        minAgentVersion: '0.0.0',
        siteOrigin: 'https://site.invalid',
        trustProxyHops: 1,
      },
      clock,
      scheduler: new FakeScheduler(clock),
      random: new NodeRandomSource(),
      ids: new RandomUuidGenerator(),
      logSink: silent,
    });
    try {
      await built.app.ready();
      for (const route of ROUTES) {
        expect(built.app.hasRoute({ method: route.method.toUpperCase() as 'GET', url: route.url })).toBe(
          true,
        );
      }
      expect(built.app.hasRoute({ method: 'POST', url: '/__test/reset' })).toBe(false);
    } finally {
      await built.app.close();
      await db.destroy();
    }

    const document = JSON.parse(await buildOpenApiText()) as Document;
    for (const route of ROUTES) {
      expect(document.paths[route.path]?.[route.method], `${route.method} ${route.path}`).toBeDefined();
    }
    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method} ${path}`),
    );
    expect(documented.sort()).toStrictEqual(ROUTES.map((r) => `${r.method} ${r.path}`).sort());

    // The schemas travel with the routes: a body where the route takes one, and every declared status.
    const observation = document.paths['/v1/lobby-rooms/{id}/observations']?.['post'];
    expect(observation?.requestBody).toBeDefined();
    expect(Object.keys(observation?.responses ?? {}).sort()).toStrictEqual(['202', '400', '401', '403']);
    // The room actions take an empty JSON body and answer 204, or 401, 403, 404 or 409 (LBR-06, LBR-07, LBR-09).
    for (const action of ['runs', 'leave', 'close']) {
      const operation = document.paths[`/v1/lobby-rooms/{id}/${action}`]?.['post'];
      expect(operation?.requestBody, action).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}).sort(), action).toStrictEqual([
        '204',
        '401',
        '403',
        '404',
        '409',
      ]);
    }
    expect(document.paths['/v1/agents/heartbeat']?.['post']?.requestBody).toBeDefined();
    // Sign-out declares no body (an unauthenticated request must answer 401 before any body is checked).
    expect(document.paths['/v1/auth/logout']?.['post']?.requestBody).toBeUndefined();
    expect(Object.keys(document.paths['/v1/auth/logout']?.['post']?.responses ?? {}).sort()).toStrictEqual([
      '204',
      '401',
      '403',
    ]);
    expect(
      Object.keys(document.paths['/v1/agents/pairing-codes/claim']?.['post']?.responses ?? {}).sort(),
    ).toStrictEqual(['200', '202', '410']);
  });

  it('openapi documents the telemetry relay', async () => {
    type Media = {
      readonly content?: Record<string, { readonly schema?: { readonly required?: readonly string[] } }>;
    };
    const document = JSON.parse(await buildOpenApiText()) as Document;
    const relay = document.paths['/v1/telemetry/traces']?.['post'];
    expect(relay).toBeDefined();
    expect(Object.keys(relay?.responses ?? {}).sort()).toStrictEqual([
      '202',
      '401',
      '403',
      '413',
      '415',
      '429',
    ]);
    // No request schema: the OTLP body is a passthrough, not a validated document.
    expect(relay?.requestBody).toBeUndefined();

    // The empty 202 carries no content; every other status is the shared error body.
    const accepted = relay?.responses?.['202'] as Media;
    expect(accepted.content).toBeUndefined();
    for (const status of ['401', '403', '413', '415', '429']) {
      const refusal = relay?.responses?.[status] as Media;
      expect(Object.keys(refusal.content ?? {}), status).toStrictEqual(['application/json']);
      expect(refusal.content?.['application/json']?.schema?.required, status).toStrictEqual(['error']);
    }
  });

  it('the committed openapi.json is the document the routes generate', async () => {
    expect(readFileSync(OPENAPI_PATH, 'utf8')).toBe(await buildOpenApiText());
  });
});
