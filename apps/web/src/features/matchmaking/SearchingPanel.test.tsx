import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueueTicketView } from '@d2rmm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { formatWait, SearchingPanel } from './SearchingPanel.tsx';

afterEach(cleanup);

function ticketJoinedSecondsAgo(seconds: number): QueueTicketView {
  return {
    id: 'q-1',
    status: 'waiting',
    mode: 'pvp',
    options: {
      mode: 'pvp',
      characterId: 'c-sorc',
      difficulty: 'hell',
      region: 'americas',
      format: 'duel',
      rules: 'gm',
    },
    joinedAt: new Date(Date.now() - seconds * 1000).toISOString(),
    band: { low: 1400, high: 1600 },
    poolSize: 3,
  };
}

describe('formatWait', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59, '0:59'],
    [60, '1:00'],
    [65, '1:05'],
    [600, '10:00'],
    [-3, '0:00'],
  ])('%s seconds read as %s', (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });
});

describe('SearchingPanel', () => {
  it('shows the time waited, the band and the pool', () => {
    renderInLanguage(
      <SearchingPanel
        ticket={ticketJoinedSecondsAgo(65)}
        client={createApiClient(routeFetch({}).fetch)}
        onLeft={vi.fn()}
      />,
    );
    expect(screen.getByText('Waited 1:05')).toBeTruthy();
    expect(screen.getByText('Rating band 1400 to 1600')).toBeTruthy();
    expect(screen.getByText('3 players in this pool')).toBeTruthy();
  });

  it('shows no band for a leveling ticket', () => {
    renderInLanguage(
      <SearchingPanel
        ticket={{ ...ticketJoinedSecondsAgo(5), band: null }}
        client={createApiClient(routeFetch({}).fetch)}
        onLeft={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Rating band/)).toBeNull();
  });

  it('leaves the queue with a DELETE and reports it', async () => {
    const { fetch, calls } = routeFetch({
      'DELETE /api/v1/queue/tickets/q-1': () => jsonResponse(204),
    });
    const onLeft = vi.fn();
    renderInLanguage(
      <SearchingPanel ticket={ticketJoinedSecondsAgo(5)} client={createApiClient(fetch)} onLeft={onLeft} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Leave queue' }));

    await vi.waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
    expect(calls[0]?.url).toBe('/api/v1/queue/tickets/q-1');
    expect(String(calls[0]?.init.body)).toBe('{}');
  });

  it('shows the failure when the queue cannot be left and keeps the ticket on screen', async () => {
    const { fetch } = routeFetch({
      'DELETE /api/v1/queue/tickets/q-1': () => jsonResponse(500),
    });
    const onLeft = vi.fn();
    renderInLanguage(
      <SearchingPanel ticket={ticketJoinedSecondsAgo(5)} client={createApiClient(fetch)} onLeft={onLeft} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Leave queue' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The queue could not be left. Try again.');
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('is reached and operated from the keyboard', async () => {
    const { fetch } = routeFetch({ 'DELETE /api/v1/queue/tickets/q-1': () => jsonResponse(204) });
    const onLeft = vi.fn();
    renderInLanguage(
      <SearchingPanel ticket={ticketJoinedSecondsAgo(5)} client={createApiClient(fetch)} onLeft={onLeft} />,
    );
    const leave = screen.getByRole('button', { name: 'Leave queue' });
    leave.focus();
    await userEvent.setup().keyboard('{Enter}');
    await vi.waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
  });
});
