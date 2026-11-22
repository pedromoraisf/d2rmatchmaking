import type * as Web from '@d2rmm/telemetry/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryTier } from '@d2rmm/telemetry';
import { journeyAttributes, readTier, telemetryOn, traceNavigation } from './telemetry.ts';

// The navigation span is read through a spy, so the test sees the path the span would carry.
const navigationSpan = vi.hoisted(() => vi.fn<(pathname: string) => void>());

vi.mock('@d2rmm/telemetry/web', async (importOriginal) => {
  const actual = await importOriginal<typeof Web>();
  return { ...actual, navigationSpan };
});

afterEach(() => {
  navigationSpan.mockClear();
  window.history.replaceState({}, '', '/');
});

describe('site telemetry', () => {
  it('the navigation span holds the path alone', () => {
    window.history.pushState({}, '', '/room/42?code=secret#token=abc');

    const stop = traceNavigation(window);

    expect(navigationSpan).toHaveBeenLastCalledWith('/room/42');
    window.history.pushState({}, '', '/profile?probe=1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigationSpan).toHaveBeenLastCalledWith('/profile');
    expect(navigationSpan).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(navigationSpan).toHaveBeenCalledTimes(2);
  });
});

describe('site telemetry tier (OBT-01, OBT-07)', () => {
  it('is on in every build unless the build says off', () => {
    expect(telemetryOn({ MODE: 'production' })).toBe(true);
    expect(telemetryOn({ VITE_TELEMETRY: 'on', MODE: 'test' })).toBe(true);
    expect(telemetryOn({ VITE_TELEMETRY: 'off', MODE: 'production' })).toBe(false);
  });

  it('reads the tier the API reports', async () => {
    expect(await readTier(() => Promise.resolve('full'))).toBe('full');
    expect(await readTier(() => Promise.resolve('production'))).toBe('production');
  });

  it('retries while the API wakes and takes the tier of the first answer', async () => {
    const answers: (TelemetryTier | null)[] = [null, null, 'full'];
    const sleep = vi.fn(() => Promise.resolve());
    const tier = await readTier(() => Promise.resolve(answers.shift() ?? null), sleep);
    expect(tier).toBe('full');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('is production when the tier cannot be read, or the read throws', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    expect(await readTier(() => Promise.resolve(null), sleep)).toBe('production');
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(await readTier(() => Promise.reject(new Error('down')), sleep)).toBe('production');
  });

  it('puts the ids on the journey in both tiers and the BattleTag in the full tier only', () => {
    const journey = {
      accountId: 'a-1',
      roomId: 'r-1',
      ticketId: 't-1',
      readyCheckId: 'c-1',
      battletag: 'Foo#1234',
    };
    const ids = {
      'd2r.account.id': 'a-1',
      'd2r.room.id': 'r-1',
      'd2r.ticket.id': 't-1',
      'd2r.ready_check.id': 'c-1',
    };
    expect(journeyAttributes(journey, 'production')).toStrictEqual({
      ...ids,
      'd2r.account.battletag': undefined,
    });
    expect(journeyAttributes(journey, 'full')).toStrictEqual({
      ...ids,
      'd2r.account.battletag': 'Foo#1234',
    });
  });
});
