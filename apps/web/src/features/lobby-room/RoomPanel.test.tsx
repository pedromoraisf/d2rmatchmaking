import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../shared/api-client.ts';
import { jsonResponse, routeFetch } from '../../test/fake-api.ts';
import { renderInLanguage } from '../../test/render.tsx';
import { type RoomMemberShown, type RoomShown, RoomPanel } from './RoomPanel.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ALICE: RoomMemberShown = {
  accountId: 'acc-alice',
  joinOrder: 1,
  role: 'host',
  confirmed: false,
  class: 'sorceress',
  level: 91,
};
const BOB: RoomMemberShown = {
  accountId: 'acc-bob',
  joinOrder: 2,
  role: 'member',
  confirmed: false,
  class: 'barbarian',
  level: 84,
};

function room(overrides: Partial<RoomShown> = {}): RoomShown {
  return {
    roomId: '4821',
    gameName: 'mmbaalh-12',
    stage: 'awaiting_host',
    run: 1,
    members: [ALICE, BOB],
    runs: [{ run: 1, gameName: 'mmbaalh-12' }],
    ...overrides,
  };
}

/** A client whose room actions answer 204 or fail, recording each call. */
function clientWith(status = 204) {
  const routes: Record<string, () => Response> = {};
  for (const action of ['runs', 'leave', 'close']) {
    routes[`POST /api/v1/lobby-rooms/4821/${action}`] = () => jsonResponse(status);
  }
  const { fetch, calls } = routeFetch(routes);
  return { client: createApiClient(fetch), calls };
}

function show(shown: RoomShown, you: string, languages: readonly string[] = ['en-US'], status = 204) {
  const { client, calls } = clientWith(status);
  const onActed = vi.fn();
  renderInLanguage(<RoomPanel room={shown} you={you} client={client} onActed={onActed} />, languages);
  return { calls, onActed };
}

describe('RoomPanel: what the room shows (LBR-12)', () => {
  it('shows the game name, "No password" and the four stages with the current one marked', () => {
    show(room(), 'acc-bob');

    expect(screen.getByText('mmbaalh-12', { selector: 'code.credential' })).toBeTruthy();
    expect(screen.getByText('No password')).toBeTruthy();
    const stages = within(screen.getByRole('list', { name: 'Room stages' })).getAllByRole('listitem');
    expect(stages.map((step) => step.textContent)).toEqual(['Formed', 'Awaiting host', 'Created', 'Active']);
    expect(stages.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
  });

  it('marks Created and Active as the current step in their stage', () => {
    show(room({ stage: 'created' }), 'acc-bob');
    expect(screen.getByText('Created', { selector: 'li' }).getAttribute('aria-current')).toBe('step');
    cleanup();
    show(room({ stage: 'active' }), 'acc-bob');
    expect(screen.getByText('Active', { selector: 'li' }).getAttribute('aria-current')).toBe('step');
  });

  it('tells the host to create a public game and open the Party panel', () => {
    show(room(), 'acc-alice');

    expect(screen.getByText(/You create a public game named mmbaalh-12 with no password/)).toBeTruthy();
    expect(screen.getByText(/open the Party panel and click the eye/)).toBeTruthy();
  });

  it('tells a member that the host creates the game and to click the eye after joining', () => {
    show(room(), 'acc-bob');

    expect(screen.getByText(/The host creates a public game named mmbaalh-12/)).toBeTruthy();
    expect(screen.getByText(/After joining, open the Party panel and click the eye/)).toBeTruthy();
  });

  it('lists the members with host mark, class, level and what the agents confirmed', () => {
    show(room({ stage: 'created', members: [{ ...ALICE, confirmed: true }, BOB] }), 'acc-bob');

    const rows = within(screen.getByRole('list', { name: 'Members' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Sorceress, level 91');
    expect(rows[0]?.textContent).toContain('Host');
    expect(rows[0]?.textContent).toContain('Confirmed by the agent');
    expect(rows[1]?.textContent).toContain('Barbarian, level 84');
    expect(rows[1]?.textContent).toContain('You');
    expect(rows[1]?.textContent).toContain('Waiting');
  });

  it('shows a member whose character is unknown without inventing one', () => {
    show(room({ members: [{ ...ALICE, class: null, level: null }, BOB] }), 'acc-bob');

    expect(screen.getByText('Character not shown')).toBeTruthy();
  });

  it('lists every run with its name and marks the current one', () => {
    show(
      room({
        run: 2,
        gameName: 'mmbaalh-13',
        runs: [
          { run: 1, gameName: 'mmbaalh-12' },
          { run: 2, gameName: 'mmbaalh-13' },
        ],
      }),
      'acc-bob',
    );

    const runs = within(screen.getByRole('list', { name: 'Runs' })).getAllByRole('listitem');
    expect(runs.map((run) => run.textContent)).toEqual(['Run 1: mmbaalh-12', 'Run 2: mmbaalh-13 (current)']);
  });

  it('has no control that confirms a member', () => {
    show(room({ stage: 'created' }), 'acc-alice');

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Copy game name', 'Close room', 'Leave room']);
  });

  it('says the room ended and offers no action once it is closed or expired', () => {
    show(room({ stage: 'expired' }), 'acc-alice');
    expect(screen.getByRole('status').textContent).toContain('expired');
    expect(screen.queryByRole('button', { name: 'Leave room' })).toBeNull();
    cleanup();
    show(room({ stage: 'closed' }), 'acc-alice');
    expect(screen.getByRole('status').textContent).toContain('closed the room');
    expect(screen.queryByRole('button', { name: 'Close room' })).toBeNull();
  });

  it('shows the room in Portuguese', () => {
    show(room({ stage: 'active' }), 'acc-alice', ['pt-BR']);

    expect(screen.getByText('Sem senha')).toBeTruthy();
    expect(screen.getByText('Aguardando anfitrião', { selector: 'li' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Próxima corrida' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sair da sala' })).toBeTruthy();
    expect(screen.getByText(/Feiticeira, nível 91/)).toBeTruthy();
  });
});

describe('RoomPanel: the buttons by role and stage', () => {
  it('gives the host Next run only while the room is active, and Close and Leave in any open stage', () => {
    show(room({ stage: 'created' }), 'acc-alice');
    expect(screen.queryByRole('button', { name: 'Next run' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close room' })).toBeTruthy();
    cleanup();
    show(room({ stage: 'active' }), 'acc-alice');
    expect(screen.getByRole('button', { name: 'Next run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave room' })).toBeTruthy();
  });

  it('gives a member only Leave room', () => {
    show(room({ stage: 'active' }), 'acc-bob');

    expect(screen.queryByRole('button', { name: 'Next run' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close room' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Leave room' })).toBeTruthy();
  });

  it.each([
    ['Next run', 'runs'],
    ['Close room', 'close'],
    ['Leave room', 'leave'],
  ])('%s posts to the room and tells the site to read it again', async (label, path) => {
    const { calls, onActed } = show(room({ stage: 'active' }), 'acc-alice');

    await userEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      `POST /api/v1/lobby-rooms/4821/${path}`,
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when an action does not go through, and does not read the room again', async () => {
    const { onActed } = show(room({ stage: 'active' }), 'acc-alice', ['en-US'], 409);

    await userEvent.click(screen.getByRole('button', { name: 'Next run' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The action did not go through. Try again.');
    expect(onActed).not.toHaveBeenCalled();
  });
});

describe('RoomPanel: copying the game name', () => {
  it('copies the name with the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show(room(), 'acc-bob');

    await userEvent.click(screen.getByRole('button', { name: 'Copy game name' }));

    expect(writeText).toHaveBeenCalledWith('mmbaalh-12');
    expect((await screen.findByRole('status')).textContent).toBe('Game name copied.');
  });

  it('selects the name and tells the player to press Ctrl+C when the Clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show(room(), 'acc-bob');

    await userEvent.click(screen.getByRole('button', { name: 'Copy game name' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Ctrl+C');
    expect(window.getSelection()?.toString()).toBe('mmbaalh-12');
  });
});

describe('RoomPanel: by keyboard only (NFR-13)', () => {
  it('reaches Copy game name and Leave room with Tab and presses them with Enter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { calls, onActed } = show(room({ stage: 'active' }), 'acc-bob');

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy game name' }));
    await userEvent.keyboard('{Enter}');
    expect(writeText).toHaveBeenCalledWith('mmbaalh-12');

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Leave room' }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/lobby-rooms/4821/leave']);
  });

  it('puts Next run and Close room before Leave room for the host, all reachable with Tab', async () => {
    show(room({ stage: 'active' }), 'acc-alice');

    const order: (string | null)[] = [];
    for (let press = 0; press < 4; press += 1) {
      await userEvent.tab();
      order.push(document.activeElement?.textContent ?? null);
    }

    expect(order).toEqual(['Copy game name', 'Next run', 'Close room', 'Leave room']);
  });
});
