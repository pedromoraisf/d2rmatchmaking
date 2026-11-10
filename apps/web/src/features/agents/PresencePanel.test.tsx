import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { PresencePanel, type PairedAgent } from './PresencePanel.tsx';

afterEach(cleanup);

const agent: PairedAgent = {
  status: 'paired',
  agentId: 'agent-1',
  online: true,
  gameRunning: false,
  screen: 'UNKNOWN',
  lastSeenAt: '2026-10-31T01:00:00Z',
};

function renderPanel(status: number, onRevoked = vi.fn()) {
  const { fetch, calls } = routeFetch({ 'DELETE /api/v1/agents/agent-1': () => jsonResponse(status) });
  renderInLanguage(<PresencePanel client={createApiClient(fetch)} agent={agent} onRevoked={onRevoked} />);
  return { onRevoked, calls };
}

describe('PresencePanel', () => {
  it('shows the presence of the agent and a revoke action, and sends nothing until confirmed', () => {
    const { calls } = renderPanel(204);
    expect(screen.getByText('Agent online')).toBeTruthy();
    expect(screen.getByText('Game closed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke agent' })).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('asks for confirmation first, and cancelling sends nothing and returns to the revoke action', async () => {
    const { calls, onRevoked } = renderPanel(204);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke agent' }));
    expect(screen.getByText('Revoke this agent? It stops working at once.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Revoke agent' })).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('revokes the agent once the player confirms, then reports it', async () => {
    const { calls, onRevoked } = renderPanel(204);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke agent' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toStrictEqual([
      'DELETE /api/v1/agents/agent-1',
    ]);
  });

  it('is usable by keyboard: the revoke action, then the confirmation, answer Enter', async () => {
    const { onRevoked } = renderPanel(204);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke agent' }));
    await user.keyboard('{Enter}');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Revoke' }));
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
  });

  it('reports the agent as revoked when it no longer belongs to this player (404), so the site reads again', async () => {
    const { onRevoked } = renderPanel(404);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke agent' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
  });

  it('shows the error message and keeps the agent on screen when the revoke fails', async () => {
    const { onRevoked } = renderPanel(500);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoke agent' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
    expect(onRevoked).not.toHaveBeenCalled();
    expect(screen.getByText('Agent online')).toBeTruthy();
  });
});
