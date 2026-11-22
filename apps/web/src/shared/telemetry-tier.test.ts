import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentTier, setTier, subscribeTier } from './telemetry-tier.ts';

afterEach(() => {
  setTier('production');
});

describe('the site telemetry tier (OBT-01)', () => {
  it('is production until it is set', () => {
    expect(currentTier()).toBe('production');
  });

  it('tells a subscriber when it changes, and not when it is set to the same value', () => {
    const listener = vi.fn();
    const stop = subscribeTier(listener);
    setTier('full');
    setTier('full');
    expect(currentTier()).toBe('full');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setTier('production');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
