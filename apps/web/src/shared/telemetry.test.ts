import type * as Web from '@d2rmm/telemetry/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { telemetryOn, traceNavigation } from './telemetry.ts';

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

  it('telemetry is on only when the build sets VITE_TELEMETRY to on', () => {
    expect(telemetryOn({ MODE: 'production' })).toBe(false);
    expect(telemetryOn({ VITE_TELEMETRY: 'off', MODE: 'production' })).toBe(false);
    expect(telemetryOn({ VITE_TELEMETRY: 'on', MODE: 'test' })).toBe(true);
  });
});
