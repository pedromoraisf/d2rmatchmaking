// The order reset stops the leftover work in: the streams close first (that schedules their site-closed drops), then the
// drops are cancelled, all before the database is touched.
import { describe, expect, it } from 'vitest';
import { resetFailure, stopLeftoverWork } from './test-controls.ts';

describe('stopLeftoverWork', () => {
  it('closes the streams, then cancels the drops they scheduled', () => {
    const calls: string[] = [];
    stopLeftoverWork({
      hub: {
        closeAll: () => calls.push('closeAll'),
        siteStreamCount: () => 0,
        closeSiteStreams: () => 0,
      },
      siteClosedTimers: { clear: () => calls.push('clearTimers') },
    });
    expect(calls).toEqual(['closeAll', 'clearTimers']);
  });
});

describe('resetFailure', () => {
  it('names the step and the Postgres code, nothing else', () => {
    expect(resetFailure(Object.assign(new Error('secret row data'), { code: '40P01' }), 'truncate')).toEqual({
      error: 'reset-failed',
      step: 'truncate',
      pgCode: '40P01',
    });
  });
  it('omits a code that is not a Postgres one', () => {
    expect(resetFailure(new Error('x'), 'stores')).toEqual({ error: 'reset-failed', step: 'stores' });
    expect(resetFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }), 'sweep')).toEqual({
      error: 'reset-failed',
      step: 'sweep',
    });
  });
});
