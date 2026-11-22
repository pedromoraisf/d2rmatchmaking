// The order reset stops the leftover work in: the streams close first (that schedules their site-closed drops), then the
// drops are cancelled, all before the database is touched.
import { describe, expect, it } from 'vitest';
import { stopLeftoverWork } from './test-controls.ts';

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
