import { describe, expect, it } from 'vitest';
import { BackgroundWork } from './background-work.ts';

function deferred(): { promise: Promise<void>; done(): void } {
  let done = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { promise, done };
}

describe('BackgroundWork', () => {
  it('pause waits for a job that started and refuses the ones after', async () => {
    const work = new BackgroundWork();
    const gate = deferred();
    expect(work.run(() => gate.promise)).toBe(true);
    let paused = false;
    const pausing = work.pause().then(() => {
      paused = true;
    });
    await Promise.resolve();
    expect(paused).toBe(false);
    expect(work.run(() => Promise.resolve())).toBe(false);
    gate.done();
    await pausing;
    expect(paused).toBe(true);
  });

  it('waits for a job that fails, and starts jobs again after resume', async () => {
    const work = new BackgroundWork();
    work.run(() => Promise.reject(new Error('boom')));
    await work.pause();
    work.resume();
    let ran = false;
    expect(
      work.run(async () => {
        ran = true;
      }),
    ).toBe(true);
    await work.pause();
    expect(ran).toBe(true);
  });
});
