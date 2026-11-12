import { afterEach, describe, expect, it } from 'vitest';
import { clearSignInFailure, signInFailedIn } from './sign-in-failure.ts';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('signInFailedIn', () => {
  it('is true only for the failure flag', () => {
    expect(signInFailedIn('?signin=failed')).toBe(true);
    expect(signInFailedIn('?x=1&signin=failed')).toBe(true);
    expect(signInFailedIn('?signin=ok')).toBe(false);
    expect(signInFailedIn('')).toBe(false);
  });
});

describe('clearSignInFailure', () => {
  it('removes the flag and keeps the path, the other parameters and the hash', () => {
    window.history.replaceState(null, '', '/site/?signin=failed&x=1#top');

    clearSignInFailure(window.location, window.history);

    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/site/?x=1#top');
  });

  it('leaves the address alone when the flag is absent', () => {
    window.history.replaceState(null, '', '/site/?x=1');

    clearSignInFailure(window.location, window.history);

    expect(window.location.pathname + window.location.search).toBe('/site/?x=1');
  });
});
