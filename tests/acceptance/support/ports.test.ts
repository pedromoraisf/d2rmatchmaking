import { describe, expect, it } from 'vitest';
import { freePort, PortInUseError, reportsAddressInUse, retryOnPortInUse } from './ports.ts';

describe('reportsAddressInUse', () => {
  it('recognises the refusals of wrangler, workerd and Node', () => {
    expect(reportsAddressInUse('[ERROR] Address already in use (127.0.0.1:34343).')).toBe(true);
    expect(reportsAddressInUse('Address already in use (socket "direct:1:default")')).toBe(true);
    expect(reportsAddressInUse('Error: listen EADDRINUSE: address already in use 127.0.0.1:3000')).toBe(true);
    expect(reportsAddressInUse('listen EADDRINUSE')).toBe(true);
  });
  it('ignores other output', () => {
    expect(reportsAddressInUse('')).toBe(false);
    expect(reportsAddressInUse('Ready on http://127.0.0.1:8788')).toBe(false);
  });
});

describe('freePort', () => {
  it('never returns a port it handed out before', async () => {
    const answers = [41001, 41001, 41002];
    const ask = (): Promise<number> => Promise.resolve(answers.shift() ?? 0);
    const first = await freePort(ask);
    const second = await freePort(ask);
    expect([first, second]).toEqual([41001, 41002]);
  });
  it('gives up when the kernel only repeats itself', async () => {
    await freePort(() => Promise.resolve(42000));
    await expect(freePort(() => Promise.resolve(42000))).rejects.toThrow('already handed out');
  });
  it('returns usable loopback ports', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
  });
});

describe('retryOnPortInUse', () => {
  it('starts again after a port collision, with the next attempt number', async () => {
    const seen: number[] = [];
    const result = await retryOnPortInUse((attempt) => {
      seen.push(attempt);
      return attempt < 3 ? Promise.reject(new PortInUseError('busy')) : Promise.resolve('up');
    });
    expect(result).toBe('up');
    expect(seen).toEqual([1, 2, 3]);
  });
  it('throws the last collision when every attempt fails', async () => {
    let calls = 0;
    await expect(
      retryOnPortInUse(() => {
        calls += 1;
        return Promise.reject(new PortInUseError('busy'));
      }, 3),
    ).rejects.toBeInstanceOf(PortInUseError);
    expect(calls).toBe(3);
  });
  it('does not retry any other error', async () => {
    let calls = 0;
    await expect(
      retryOnPortInUse(() => {
        calls += 1;
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
