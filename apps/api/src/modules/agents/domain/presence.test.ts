import { describe, expect, it } from 'vitest';
import { Presence } from './presence.ts';

const T0 = new Date('2026-10-30T12:00:00.000Z');

const base = Presence.fromHeartbeat({ gameRunning: true, screen: 'UNKNOWN' }, T0);

describe('Presence', () => {
  it('builds an online presence from a heartbeat at now', () => {
    expect(base).toEqual({ online: true, gameRunning: true, screen: 'UNKNOWN', lastSeenAt: T0 });
  });

  it('marks the agent offline after 45 s', () => {
    expect(Presence.isOfflineAt(base, new Date(T0.getTime() + 44_999))).toBe(false);
    expect(Presence.isOfflineAt(base, new Date(T0.getTime() + 45_000))).toBe(true);
  });

  it('differs on online, gameRunning and screen', () => {
    expect(Presence.differs(base, { ...base, online: false })).toBe(true);
    expect(Presence.differs(base, { ...base, gameRunning: false })).toBe(true);
    expect(Presence.differs(base, { ...base, screen: 'AUTOMAP_OPEN' })).toBe(true);
  });

  it('does not differ when only the last-seen instant moved', () => {
    expect(Presence.differs(base, { ...base, lastSeenAt: new Date(T0.getTime() + 1000) })).toBe(false);
  });
});
