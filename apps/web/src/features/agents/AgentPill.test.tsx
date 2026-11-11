import { cleanup, screen } from '@testing-library/react';
import type { AgentView } from '@d2rmm/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInLanguage } from '../../test/render.tsx';
import { AgentPill, agentPillShown } from './AgentPill.tsx';

afterEach(cleanup);

const paired = (online: boolean, gameRunning: boolean): AgentView => ({
  status: 'paired',
  agentId: 'agent-1',
  online,
  gameRunning,
  screen: 'UNKNOWN',
  lastSeenAt: null,
});

describe('agentPillShown', () => {
  it('shows no agent when none is paired or the agent is unknown', () => {
    expect(agentPillShown(null)).toEqual({ state: 'none', key: 'header.agent.none' });
    expect(agentPillShown({ status: 'none' })).toEqual({ state: 'none', key: 'header.agent.none' });
  });

  it('shows an offline agent as not connected, whatever the game shows', () => {
    expect(agentPillShown(paired(false, false))).toEqual({ state: 'offline', key: 'header.agent.offline' });
    expect(agentPillShown(paired(false, true))).toEqual({ state: 'offline', key: 'header.agent.offline' });
  });

  it('shows an online agent with the game closed or open', () => {
    expect(agentPillShown(paired(true, false))).toEqual({ state: 'online', key: 'header.agent.gameClosed' });
    expect(agentPillShown(paired(true, true))).toEqual({ state: 'online', key: 'header.agent.gameOpen' });
  });
});

describe('AgentPill', () => {
  it('shows the label of an online agent with the game closed, in English', () => {
    renderInLanguage(<AgentPill agent={paired(true, false)} />, ['en-US']);
    expect(screen.getByText('Agent online · game closed')).toBeTruthy();
  });

  it('shows the label of a player with no agent, in pt-BR', () => {
    renderInLanguage(<AgentPill agent={null} />, ['pt-BR']);
    expect(screen.getByText('Nenhum agente pareado')).toBeTruthy();
  });
});
