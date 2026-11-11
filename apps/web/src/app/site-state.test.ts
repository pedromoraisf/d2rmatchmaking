import { describe, expect, it } from 'vitest';
import type { ReadyCheckView, SiteStreamEvent } from '@d2rmm/contracts';
import { applyStreamEvent } from './site-state.ts';

const check: ReadyCheckView = {
  id: 'rc-1',
  mode: 'pvp',
  difficulty: 'hell',
  deadline: '2026-11-10T12:01:00.000Z',
  members: [
    { position: 1, class: 'sorceress', level: 91, accepted: false, you: true },
    { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
  ],
};

const started: SiteStreamEvent = { type: 'ready_check.started', data: check };

describe('applyStreamEvent: ready checks (RDY-01 … RDY-03)', () => {
  it('shows the check the stream opens', () => {
    const next = applyStreamEvent({ agent: null, room: null, readyCheck: null }, started);
    expect(next.readyCheck).toStrictEqual(check);
  });

  it('replaces the view with an acceptance of the same check', () => {
    const accepted: ReadyCheckView = {
      ...check,
      members: [
        { position: 1, class: 'sorceress', level: 91, accepted: true, you: true },
        { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
      ],
    };
    const next = applyStreamEvent(
      { agent: null, room: null, readyCheck: check },
      { type: 'ready_check.updated', data: accepted },
    );
    expect(next.readyCheck?.members[0]?.accepted).toBe(true);
  });

  it('ignores an update for a check the player is not showing', () => {
    const state = { agent: null, room: null, readyCheck: check };
    const next = applyStreamEvent(state, { type: 'ready_check.updated', data: { ...check, id: 'rc-other' } });
    expect(next).toBe(state);
  });

  it('clears the check when it resolves', () => {
    const next = applyStreamEvent(
      { agent: null, room: null, readyCheck: check },
      { type: 'ready_check.resolved', data: { id: 'rc-1', outcome: 'declined' } },
    );
    expect(next.readyCheck).toBeNull();
  });

  it('keeps the check when a different one resolves', () => {
    const state = { agent: null, room: null, readyCheck: check };
    const next = applyStreamEvent(state, {
      type: 'ready_check.resolved',
      data: { id: 'rc-other', outcome: 'accepted' },
    });
    expect(next).toBe(state);
  });
});
