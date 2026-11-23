import { describe, expect, it } from 'vitest';
import { createDeadlineRegistry } from './deadline-registry.ts';

describe('deadline registry', () => {
  it('holds one entry per open check', () => {
    const registry = createDeadlineRegistry();
    registry.hold('check-1', () => undefined);
    registry.hold('check-2', () => undefined);
    expect(registry.pending()).toBe(2);
  });

  it('cancels the deadline of a released check and drops its entry, leaving the others', () => {
    const registry = createDeadlineRegistry();
    const cancelled: string[] = [];
    registry.hold('check-1', () => cancelled.push('check-1'));
    registry.hold('check-2', () => cancelled.push('check-2'));

    registry.release('check-1');

    expect(cancelled).toStrictEqual(['check-1']);
    expect(registry.pending()).toBe(1);
  });

  it('does nothing for a check it does not hold', () => {
    const registry = createDeadlineRegistry();
    registry.release('missing');
    expect(registry.pending()).toBe(0);
  });
});
