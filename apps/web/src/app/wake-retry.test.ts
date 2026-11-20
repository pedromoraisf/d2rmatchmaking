import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../shared/api-client.ts';
import { readWhenAwake, wakeDelayMs, WAKE_BUDGET_MS } from './wake-retry.ts';

const waking: ApiResult<string> = { ok: false, failure: 'waking' };
const ok: ApiResult<string> = { ok: true, value: 'x' };

describe('wakeDelayMs', () => {
  it('grows by half from 2 s and stops at 10 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(wakeDelayMs)).toEqual([2000, 3000, 4500, 6750, 10000, 10000, 10000]);
  });
});

describe('readWhenAwake', () => {
  it('answers at once, with no message, when the server is awake', async () => {
    const onWaking = vi.fn();
    const sleep = vi.fn(() => Promise.resolve());
    expect(await readWhenAwake(() => Promise.resolve(ok), { onWaking, sleep })).toEqual(ok);
    expect(onWaking).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('says the server is waking once, retries, and returns the answer when it comes', async () => {
    const onWaking = vi.fn();
    const answers = [waking, waking, ok];
    const read = vi.fn(() => Promise.resolve(answers.shift() ?? ok));
    const sleep = vi.fn(() => Promise.resolve());
    expect(await readWhenAwake(read, { onWaking, sleep })).toEqual(ok);
    expect(onWaking).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls).toEqual([[2000], [3000]]);
  });

  it('gives up after exactly 90 seconds of waiting and returns the last answer', async () => {
    const slept: number[] = [];
    const read = vi.fn(() => Promise.resolve(waking));
    const result = await readWhenAwake(read, {
      onWaking: () => undefined,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    expect(result).toEqual(waking);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(WAKE_BUDGET_MS);
    expect(read).toHaveBeenCalledTimes(slept.length + 1);
  });

  it('does not retry another failure', async () => {
    const read = vi.fn(() => Promise.resolve<ApiResult<string>>({ ok: false, failure: 'failed' }));
    const sleep = vi.fn(() => Promise.resolve());
    await readWhenAwake(read, { onWaking: () => undefined, sleep });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller is gone', async () => {
    const read = vi.fn(() => Promise.resolve(waking));
    await readWhenAwake(read, {
      onWaking: () => undefined,
      sleep: () => Promise.resolve(),
      active: () => false,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
