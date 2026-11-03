// A bare Fastify app with the telemetry relay and its real guards, limiter, budget and forwarder (OBS-10 to OBS-16). The
// credentials come from fakes of the Identity and Agents ports, so the relay tests need no database. A platform test may
// not import the composition root (`main/`), so the app is assembled here from the platform pieces, as `buildApp` does.
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AgentsPort } from '../../src/modules/agents/index.ts';
import type { IdentityPort } from '../../src/modules/identity/index.ts';
import { answerError } from '../../src/platform/http/answer-error.ts';
import { createGuards } from '../../src/platform/http/guards.ts';
import { RelayBudget } from '../../src/platform/http/relay-budget.ts';
import { Forwarder, type FetchLike } from '../../src/platform/http/relay-forwarder.ts';
import { RelayLimiter } from '../../src/platform/http/relay-limiter.ts';
import { telemetryRelayPlugin } from '../../src/platform/http/telemetry-relay.ts';
import { atMostOnePerMinute, type ErrorLog } from '../../src/platform/error-log.ts';
import { err, FakeClock, FakeScheduler, ok } from '../../src/shared-kernel/index.ts';

export const SITE_ORIGIN = 'https://site.example';
export const SESSION_TOKEN = 'd2rmm_s_good';
export const SESSION_COOKIE = `__Host-d2rmm_session=${SESSION_TOKEN}`;
export const AGENT_TOKEN = 'd2rmm_a_good';
export const ACCOUNT_ID = 'account-1';
export const AGENT_ID = 'agent-1';
export const BACKEND_AUTHORIZATION = 'Bearer backend-key-secret';
export const START = new Date('2026-11-02T12:00:00.000Z');

/**
 * The Agents port as the use case behaves for the relay: a cache hit answers without `beforeLookup`; a miss asks it and,
 * when it refuses, answers `throttled` with no repository read. `repositoryReads` counts the reads (AD-097).
 */
export class FakeAgentsPort implements AgentsPort {
  repositoryReads = 0;
  readonly #cached = new Set<string>();

  async authenticateAgent(token: string, opts?: { beforeLookup?: () => boolean }) {
    if (this.#cached.has(token)) {
      return ok({ agentId: AGENT_ID, accountId: ACCOUNT_ID });
    }
    if (opts?.beforeLookup !== undefined && !opts.beforeLookup()) {
      return err('throttled' as const);
    }
    this.repositoryReads += 1;
    if (token !== AGENT_TOKEN) {
      return err('unauthenticated' as const);
    }
    this.#cached.add(token);
    return ok({ agentId: AGENT_ID, accountId: ACCOUNT_ID });
  }

  async accountOfAgent(): Promise<string | null> {
    return ACCOUNT_ID;
  }

  async currentAgentOf(): Promise<string | null> {
    return AGENT_ID;
  }
}

/** The Identity port: one valid session, of the account the agent belongs to. */
export const fakeIdentity: IdentityPort = {
  async authenticateSession(token) {
    return token === SESSION_TOKEN
      ? ok({ accountId: ACCOUNT_ID, expiresAt: new Date('2026-11-09T12:00:00.000Z') })
      : err('unauthenticated');
  },
};

export interface RelayApp {
  readonly app: FastifyInstance;
  readonly clock: FakeClock;
  readonly agents: FakeAgentsPort;
  readonly limiter: RelayLimiter;
  readonly budget: RelayBudget;
  /** The lines the relay logged, in order (the one-a-minute gate of the app is applied). */
  readonly logged: string[];
  close(): Promise<void>;
}

export interface RelayAppOptions {
  /** The backend base URL, or undefined for no endpoint. */
  readonly endpoint: string | undefined;
  /** Replaces the default `fetch` of the forwarder. */
  readonly fetch?: FetchLike;
  readonly start?: Date;
}

/** Builds the relay app. Each call is a fresh app with its own clock, limiter, budget and forwarder. */
export async function startRelayApp(options: RelayAppOptions): Promise<RelayApp> {
  const clock = new FakeClock(options.start ?? START);
  const agents = new FakeAgentsPort();
  const logged: string[] = [];
  const log: ErrorLog = atMostOnePerMinute({ error: (message) => logged.push(message) }, clock);
  const guards = createGuards({
    identity: fakeIdentity,
    agents,
    agentMinVersion: '0.0.0',
    siteOrigin: SITE_ORIGIN,
    clock,
  });
  const limiter = new RelayLimiter(clock);
  const budget = new RelayBudget(clock);
  const forwarder = new Forwarder({
    endpoint: options.endpoint,
    credentials: { authorization: BACKEND_AUTHORIZATION },
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    log,
  });
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(answerError);
  await app.register(telemetryRelayPlugin, {
    guards,
    limiter,
    budget,
    forwarder,
    clock,
    scheduler: new FakeScheduler(clock),
  });
  return {
    app,
    clock,
    agents,
    limiter,
    budget,
    logged,
    close: async () => {
      await app.close();
    },
  };
}
