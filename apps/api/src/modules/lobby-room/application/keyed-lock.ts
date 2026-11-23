/**
 * One promise chain per key: the work of a key runs one after the other (rooms are in one process, ADR 006). A key
 * with nothing running or waiting holds no entry, so `pending()` is the number of keys with work in flight.
 */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  }
  return { locked, pending: (): number => tails.size };
}
