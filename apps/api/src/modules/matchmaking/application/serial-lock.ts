/**
 * Runs the queue's work one piece at a time, in call order. A join, a leave, a drop and a matcher run each read and
 * then change the queue; without the lock a join could land between a matcher's read and its removal and put a
 * ticket into two groups. A failing piece does not stop the next one.
 */
export interface SerialLock {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export function createSerialLock(): SerialLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = tail.then(work);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
