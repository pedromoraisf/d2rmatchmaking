import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadyCheckView } from '@d2rmm/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { ReadyCheckOverlay, secondsUntil } from './ReadyCheckOverlay.tsx';

afterEach(cleanup);

const DEADLINE = new Date(Date.now() + 60_000).toISOString();
const SERVER_NOW = new Date().toISOString();

function check(overrides: Partial<ReadyCheckView> = {}): ReadyCheckView {
  return {
    id: 'rc-1',
    mode: 'pvp',
    difficulty: 'hell',
    deadline: DEADLINE,
    now: SERVER_NOW,
    members: [
      { position: 1, class: 'sorceress', level: 91, accepted: false, you: true },
      { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
    ],
    ...overrides,
  };
}

describe('secondsUntil', () => {
  it.each([
    [60_000, 60],
    [59_001, 60],
    [59_000, 59],
    [1, 1],
    [0, 0],
    [-5_000, 0],
  ])('%i ms before the deadline reads as %i whole seconds', (ms, seconds) => {
    const now = 1_000_000;
    expect(secondsUntil(new Date(now + ms).toISOString(), now)).toBe(seconds);
  });
});

describe('ReadyCheckOverlay: the countdown (RDY-11)', () => {
  it('counts the minute from the server time, whatever the browser clock reads', () => {
    // The server says it is 12:00:00 and the check ends at 12:01:00; the browser's clock is years behind.
    const serverNow = '2026-11-10T12:00:00.000Z';
    const deadline = '2026-11-10T12:01:00.000Z';
    const skewed = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2019-03-04T08:00:00.000Z'));
    try {
      renderInLanguage(
        <ReadyCheckOverlay
          readyCheck={check({ deadline, now: serverNow })}
          client={createApiClient(routeFetch({}).fetch)}
        />,
      );
      expect(screen.getByText('60 seconds left')).toBeTruthy();
    } finally {
      skewed.mockRestore();
    }
  });
});

describe('ReadyCheckOverlay (RDY-08)', () => {
  it('shows the members by position with their class and level, and marks the player', () => {
    renderInLanguage(
      <ReadyCheckOverlay readyCheck={check()} client={createApiClient(routeFetch({}).fetch)} />,
    );

    expect(screen.getByRole('dialog', { name: 'Ready check' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Member 1: Sorceress, level 91' }).textContent).toContain(
      'YOU',
    );
    expect(screen.getByRole('listitem', { name: 'Member 2: Barbarian, level 84' })).toBeTruthy();
  });

  it('says that declining has no penalty and that not answering gives a 5-minute wait', () => {
    renderInLanguage(
      <ReadyCheckOverlay readyCheck={check()} client={createApiClient(routeFetch({}).fetch)} />,
    );
    expect(screen.getByText('Declining has no penalty. Not answering gives a 5-minute wait.')).toBeTruthy();
  });

  it('shows the hotkey hint with the hotkey in a key element', () => {
    renderInLanguage(
      <ReadyCheckOverlay readyCheck={check()} client={createApiClient(routeFetch({}).fetch)} />,
    );
    const key = screen.getByText('Ctrl+Shift+A');
    expect(key.tagName).toBe('KBD');
    expect(key.parentElement?.textContent).toBe(
      'You can also accept with Ctrl+Shift+A without leaving the game.',
    );
  });

  it('moves the focus to Accept when the check opens', () => {
    renderInLanguage(
      <ReadyCheckOverlay readyCheck={check()} client={createApiClient(routeFetch({}).fetch)} />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept' }));
  });

  it('accepts when Enter is pressed on the focused Accept button', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/accept': () => jsonResponse(204),
    });
    renderInLanguage(<ReadyCheckOverlay readyCheck={check()} client={createApiClient(fetch)} />);

    await userEvent.setup().keyboard('{Enter}');

    await waitFor(() =>
      expect(calls.map((call) => call.url)).toStrictEqual(['/api/v1/ready-checks/rc-1/accept']),
    );
  });

  it('does not decline on Escape', async () => {
    const { fetch, calls } = routeFetch({});
    renderInLanguage(<ReadyCheckOverlay readyCheck={check()} client={createApiClient(fetch)} />);

    await userEvent.setup().keyboard('{Escape}');

    expect(calls).toStrictEqual([]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('declines when Decline is chosen', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/decline': () => jsonResponse(204),
    });
    renderInLanguage(<ReadyCheckOverlay readyCheck={check()} client={createApiClient(fetch)} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() =>
      expect(calls.map((call) => call.url)).toStrictEqual(['/api/v1/ready-checks/rc-1/decline']),
    );
  });

  it('turns Accept and Decline off once the player has accepted', () => {
    const accepted = check({
      members: [
        { position: 1, class: 'sorceress', level: 91, accepted: true, you: true },
        { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
      ],
    });
    renderInLanguage(
      <ReadyCheckOverlay readyCheck={accepted} client={createApiClient(routeFetch({}).fetch)} />,
    );

    expect(screen.getByRole('button', { name: 'Accept' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Decline' })).toHaveProperty('disabled', true);
  });

  it('says the answer did not count when the API refuses it', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/accept': () => jsonResponse(409, { error: 'ready-check-ended' }),
    });
    renderInLanguage(<ReadyCheckOverlay readyCheck={check()} client={createApiClient(fetch)} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'This answer did not count. The check may have ended.',
    );
  });

  it('calls the accept route once per click', async () => {
    const onAnswer = vi.fn();
    const { fetch, calls } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/accept': () => {
        onAnswer();
        return jsonResponse(204);
      },
    });
    renderInLanguage(<ReadyCheckOverlay readyCheck={check()} client={createApiClient(fetch)} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });
});
