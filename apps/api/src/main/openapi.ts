// The OpenAPI generator (design.md § Composition roots, AWS-36): builds the app with in-memory ports and writes the
// document Fastify's swagger plugin derives from the routes to packages/contracts/openapi.json. `pnpm contracts:openapi`
// runs it. No database is ever queried: the app is built only to be described, so its Kysely instance never connects.
import { writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { FakeClock, FakeScheduler } from '../shared-kernel/index.ts';
import { buildApp, type AppDatabase } from './app.ts';
import { NodeRandomSource, RandomUuidGenerator } from './runtime.ts';

/** The committed contract document, relative to this file: apps/api/src/main → repository root. */
export const OPENAPI_PATH = fileURLToPath(
  new URL('../../../../packages/contracts/openapi.json', import.meta.url),
);

/**
 * The OpenAPI document as the committed file holds it. Staging is on, so the document describes every route the API
 * registers. The output is deterministic: the same routes give the same bytes.
 */
export async function buildOpenApiText(): Promise<string> {
  const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
  // The pool connects on first use, and building the app never queries: the database is only a type carrier here.
  const db = new Kysely<AppDatabase>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: 'postgres://openapi-only.invalid/none' }),
    }),
  });
  const silent = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
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
    return `${JSON.stringify(built.app.swagger(), null, 2)}\n`;
  } finally {
    await built.app.close();
    await db.destroy();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OPENAPI_PATH, await buildOpenApiText());
}
