import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { Agent } from '../domain/agent.ts';
import { createAccountOfAgent, createCurrentAgentOf } from './agent-lookups.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const TX = {} as Transaction;

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

async function setup() {
  const agents = new InMemoryAgentRepository();
  const paired = new Agent({ id: 'agent-1', claimSecretHash: 'claim-1' }).pair('account-1', START);
  await agents.insert(TX, paired);
  await agents.insert(TX, new Agent({ id: 'agent-2', claimSecretHash: 'claim-2' }));
  const revoked = new Agent({ id: 'agent-3', claimSecretHash: 'claim-3' }).pair('account-3', START);
  await agents.insert(TX, revoked);
  await agents.save(TX, revoked.revoke(START));
  return {
    agents,
    accountOfAgent: createAccountOfAgent({ agents }),
    currentAgentOf: createCurrentAgentOf({ agents }),
  };
}

describe('accountOfAgent', () => {
  it('returns the account a paired agent belongs to', async () => {
    const { accountOfAgent } = await setup();

    expect(await accountOfAgent('agent-1')).toBe('account-1');
  });

  it('returns null for an agent that was never paired', async () => {
    const { accountOfAgent } = await setup();

    expect(await accountOfAgent('agent-2')).toBeNull();
  });

  it('returns null for a revoked agent', async () => {
    const { accountOfAgent } = await setup();

    expect(await accountOfAgent('agent-3')).toBeNull();
  });

  it('returns null for an unknown agent and opens its span', async () => {
    const { accountOfAgent } = await setup();

    expect(await accountOfAgent('agent-unknown')).toBeNull();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['agents.account-of-agent']);
  });
});

describe('currentAgentOf', () => {
  it('returns the current agent of an account', async () => {
    const { currentAgentOf } = await setup();

    expect(await currentAgentOf('account-1')).toBe('agent-1');
  });

  it('returns null when the account has no agent or only a revoked one', async () => {
    const { currentAgentOf } = await setup();

    expect(await currentAgentOf('account-2')).toBeNull();
    expect(await currentAgentOf('account-3')).toBeNull();
  });

  it('opens its span with the use-case name', async () => {
    const { currentAgentOf } = await setup();

    await currentAgentOf('account-1');

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['agents.current-agent-of']);
  });
});
