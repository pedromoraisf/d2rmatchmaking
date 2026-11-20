import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../shared/api-client.ts';
import {
  ATTEMPT_TIMEOUT_MS,
  jitteredDelayMs,
  readWhenAwake,
  wakeDelayMs,
  WAKE_BUDGET_MS,
} from './wake-retry.ts';

const waking: ApiResult<string> = { ok: false, failure: 'waking' };
const ok: ApiResult<string> = { ok: true, value: 'x' };

describe('wakeDelayMs', () => {
  it('grows by half from 2 s and stops at 10 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(wakeDelayMs)).toEqual([2000, 3000, 4500, 6750, 10000, 10000, 10000]);
  });
});

describe('jitteredDelayMs', () => {
  it('stays within 25 % either way of the delay, at both ends of the random range', () => {
    expect(jitteredDelayMs(4000, () => 0)).toBe(3000);
    expect(jitteredDelayMs(4000, () => 0.5)).toBe(4000);
    expect(jitteredDelayMs(4000, () => 0.999999)).toBe(5000);
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

  it('varies each wait by the injected random source and still spends exactly the budget', async () => {
    const slept: number[] = [];
    const randoms = [0, 0.999999];
    let call = 0;
    await readWhenAwake(() => Promise.resolve(waking), {
      onWaking: () => undefined,
      random: () => randoms[call++ % 2] ?? 0.5,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    expect(slept.slice(0, 2)).toEqual([1500, 3750]);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(WAKE_BUDGET_MS);
  });

  it('gives every attempt its own timeout signal of 15 s', async () => {
    const asked: number[] = [];
    const signals: AbortSignal[] = [];
    const answers = [waking, ok];
    await readWhenAwake(
      (signal) => {
        signals.push(signal);
        return Promise.resolve(answers.shift() ?? ok);
      },
      {
        onWaking: () => undefined,
        sleep: () => Promise.resolve(),
        timeoutSignal: (ms) => {
          asked.push(ms);
          return new AbortController().signal;
        },
      },
    );
    expect(asked).toEqual([ATTEMPT_TIMEOUT_MS, ATTEMPT_TIMEOUT_MS]);
    expect(ATTEMPT_TIMEOUT_MS).toBe(15_000);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('counts an attempt that timed out as a server still asleep, and retries', async () => {
    const onWaking = vi.fn();
    const answers: ApiResult<string>[] = [{ ok: false, failure: 'failed' }, ok];
    const controller = new AbortController();
    controller.abort();
    const signals = [controller.signal, new AbortController().signal];
    const result = await readWhenAwake(() => Promise.resolve(answers.shift() ?? ok), {
      onWaking,
      sleep: () => Promise.resolve(),
      timeoutSignal: () => signals.shift() ?? new AbortController().signal,
    });
    expect(result).toEqual(ok);
    expect(onWaking).toHaveBeenCalledTimes(1);
  });

  it('keeps a plain failure of an attempt that did not time out', async () => {
    const read = vi.fn(() => Promise.resolve<ApiResult<string>>({ ok: false, failure: 'failed' }));
    const result = await readWhenAwake(read, {
      onWaking: () => undefined,
      sleep: () => Promise.resolve(),
      timeoutSignal: () => new AbortController().signal,
    });
    expect(result).toEqual({ ok: false, failure: 'failed' });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
