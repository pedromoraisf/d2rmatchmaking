import { describe, expect, it } from 'vitest';
import { createKeyedLock } from './keyed-lock.ts';

function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('keyed lock', () => {
  it('runs the work of one key one after the other and the work of two keys side by side', async () => {
    const { locked } = createKeyedLock();
    const order: string[] = [];
    const gate = deferred();

    const first = locked('room-1', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    const second = locked('room-1', () => {
      order.push('second');
      return Promise.resolve();
    });
    const other = locked('room-2', () => {
      order.push('other');
      return Promise.resolve();
    });
    await other;
    expect(order).toEqual(['first:start', 'other']);
    gate.release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first:start', 'other', 'first:end', 'second']);
  });

  it('keeps one entry per busy key and drops it when the last work of that key ends', async () => {
    const { locked, pending } = createKeyedLock();
    const gate = deferred();
    expect(pending()).toBe(0);

    const first = locked('room-1', () => gate.promise);
    const second = locked('room-1', () => Promise.resolve());
    const other = locked('room-2', () => gate.promise);
    expect(pending()).toBe(2);

    gate.release();
    await Promise.all([first, second, other]);
    expect(pending()).toBe(0);
  });

  it('keeps the entry while a later work of the key still waits', async () => {
    const { locked, pending } = createKeyedLock();
    const gate = deferred();
    const later = deferred();

    const first = locked('room-1', () => gate.promise);
    const second = locked('room-1', () => later.promise);
    gate.release();
    await first;
    expect(pending()).toBe(1);

    later.release();
    await second;
    expect(pending()).toBe(0);
  });

  it('returns the result of the work, runs the next one after a failure, and drops the entry after it', async () => {
    const { locked, pending } = createKeyedLock();

    const failing = locked('room-1', () => Promise.reject(new Error('boom')));
    const next = locked('room-1', () => Promise.resolve(7));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe(7);
    expect(pending()).toBe(0);
  });
});
