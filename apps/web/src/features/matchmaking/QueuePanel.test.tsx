import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CharacterView, QueueTicketView } from '@d2rmm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { QueuePanel } from './QueuePanel.tsx';

afterEach(cleanup);

const SORC: CharacterView = {
  id: 'c-sorc',
  name: 'Sorc',
  class: 'sorceress',
  level: 90,
  hardcore: false,
  ladder: 'ladder',
  era: 'rotw',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
  readAt: '2026-11-10T12:00:00.000Z',
};

/** Cara's Zon: level 45, no Hell, the ladder and era declared (the scenario "Cara ... Zon"). */
const ZON: CharacterView = {
  ...SORC,
  id: 'c-zon',
  name: 'Zon',
  class: 'amazon',
  level: 45,
  unlockedDifficulties: ['normal', 'nightmare'],
};

const TICKET: QueueTicketView = {
  id: 'q-1',
  status: 'waiting',
  mode: 'pvp',
  options: {
    mode: 'pvp',
    characterId: 'c-sorc',
    difficulty: 'normal',
    region: 'americas',
    format: 'duel',
    rules: 'gm',
  },
  joinedAt: '2026-11-10T12:00:00.000Z',
  band: { low: 1450, high: 1550 },
  poolSize: 1,
};

/** The accessible description of an element: the text of the elements its aria-describedby names. */
function descriptionOf(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

function joinBody(calls: { init: RequestInit }[]): unknown {
  return JSON.parse(String(calls[0]?.init.body));
}

describe('QueuePanel', () => {
  it('disables a locked difficulty and says it is locked on this character', () => {
    renderInLanguage(
      <QueuePanel
        characters={[ZON]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={null}
        onJoined={vi.fn()}
      />,
    );
    const hell = screen.getByRole('radio', { name: /Hell/ });
    expect(hell).toHaveProperty('disabled', true);
    expect(descriptionOf(hell)).toBe('Locked on this character');
    expect(screen.getByRole('radio', { name: /Nightmare/ })).toHaveProperty('disabled', false);
  });

  it('keeps Find match off and shows the first failing rule as its reason', () => {
    const undeclared = { ...SORC, ladder: null } satisfies CharacterView;
    renderInLanguage(
      <QueuePanel
        characters={[undeclared]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={null}
        onJoined={vi.fn()}
      />,
    );
    const find = screen.getByRole('button', { name: 'Find match' });
    expect(find).toHaveProperty('disabled', true);
    expect(descriptionOf(find)).toBe('Declare ladder and era to queue with this character');
  });

  it('turns Find match on once every rule passes', () => {
    renderInLanguage(
      <QueuePanel
        characters={[SORC]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={null}
        onJoined={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Find match' })).toHaveProperty('disabled', false);
  });

  it('says to read a character first when there is none', () => {
    renderInLanguage(
      <QueuePanel
        characters={[]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={null}
        onJoined={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Find match' })).toHaveProperty('disabled', true);
    expect(
      screen.getByText('Read a character first: open the character selection screen with the agent running.'),
    ).toBeTruthy();
  });

  it('joins the PvP queue with the chosen options and hands the ticket up', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/queue/tickets': () => jsonResponse(201, TICKET),
    });
    const onJoined = vi.fn();
    renderInLanguage(
      <QueuePanel characters={[SORC]} client={createApiClient(fetch)} notice={null} onJoined={onJoined} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Find match' }));

    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledWith(TICKET));
    expect(joinBody(calls)).toStrictEqual({
      mode: 'pvp',
      characterId: 'c-sorc',
      difficulty: 'normal',
      region: 'americas',
      format: 'duel',
      rules: 'gm',
    });
  });

  it('joins the leveling queue with the activity, role and minimum level', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/queue/tickets': () => jsonResponse(201, { ...TICKET, mode: 'leveling', band: null }),
    });
    const onJoined = vi.fn();
    renderInLanguage(
      <QueuePanel characters={[SORC]} client={createApiClient(fetch)} notice={null} onJoined={onJoined} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leveling' }));
    await user.click(screen.getByRole('radio', { name: 'Killer' }));
    await user.click(screen.getByRole('button', { name: 'Find match' }));

    await vi.waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
    expect(joinBody(calls)).toStrictEqual({
      mode: 'leveling',
      characterId: 'c-sorc',
      difficulty: 'normal',
      region: 'americas',
      activity: 'baal',
      role: 'killer',
      minLevel: 10,
    });
  });

  it('answers the mode buttons and the radio groups from the keyboard', async () => {
    renderInLanguage(
      <QueuePanel
        characters={[SORC]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={null}
        onJoined={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const leveling = screen.getByRole('button', { name: 'Leveling' });
    leveling.focus();
    await user.keyboard('{Enter}');
    expect(leveling.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Killer' })).toBeTruthy();
  });

  it('says the reason the API refused the join, in words, and does not join', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/queue/tickets': () => jsonResponse(422, { error: 'agent-offline' }),
    });
    const onJoined = vi.fn();
    renderInLanguage(
      <QueuePanel characters={[SORC]} client={createApiClient(fetch)} notice={null} onJoined={onJoined} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Find match' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your agent is offline. Open it on this PC and try again.',
    );
    expect(onJoined).not.toHaveBeenCalled();
  });

  it.each([
    ['not-your-character', 'That character is not on your account. Pick another one.'],
    ['undeclared-character', 'Declare the ladder and era of this character first.'],
    ['difficulty-locked', 'This difficulty is locked on this character.'],
    ['below-floor', 'This character is under the level for this difficulty.'],
    ['below-minimum-level', 'This character is under the minimum level you chose.'],
    ['minimum-below-floor', 'The minimum level is under the level for this difficulty.'],
    ['activity-not-available', 'Heralds needs Hell and Reign of the Warlock.'],
    ['agent-offline', 'Your agent is offline. Open it on this PC and try again.'],
    ['not-linked', 'Link a Battle.net account to join the queue.'],
    ['site-not-open', 'Keep this site open to join the queue.'],
    ['already-queued', 'You already have a ticket in the queue.'],
    ['in-room', 'You are in a room that is still open.'],
  ] as const)('has a message for the refusal %s', async (code, message) => {
    const status = code === 'already-queued' || code === 'in-room' ? 409 : 422;
    const { fetch } = routeFetch({
      'POST /api/v1/queue/tickets': () => jsonResponse(status, { error: code }),
    });
    renderInLanguage(
      <QueuePanel characters={[SORC]} client={createApiClient(fetch)} notice={null} onJoined={vi.fn()} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Find match' }));

    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });

  it('shows the generic message when the join fails for another reason', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/queue/tickets': () => jsonResponse(500),
    });
    renderInLanguage(
      <QueuePanel characters={[SORC]} client={createApiClient(fetch)} notice={null} onJoined={vi.fn()} />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Find match' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The queue did not accept the request. Try again.',
    );
  });

  it('says why the ticket left on its own, once', () => {
    const offline = 'agent-offline' as const;
    renderInLanguage(
      <QueuePanel
        characters={[SORC]}
        client={createApiClient(routeFetch({}).fetch)}
        notice={offline}
        onJoined={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('You left the queue: your agent went offline.');
  });
});
