// Free loopback ports for the acceptance stacks, and the retry that gives a stack new ports when one was taken.
//
// A port found free is released before the child process binds it, and the stack starts its processes one after the
// other (API, then site), so seconds pass in between. In that window another worker's processes, or an outgoing
// connection of the kernel (ephemeral source ports share the range), can take the port: wrangler then exits with
// "Address already in use" and the worker's scenarios all fail. The cause is the window, so a stack that loses the race
// is torn down and started again on new ports; it is never retried on the same ones.
import { createServer } from 'node:net';

/** Raised when a child process could not bind a port: the stack must be started again on other ports. */
export class PortInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortInUseError';
  }
}

/** True when a process output reports a refused bind (Node `EADDRINUSE`, wrangler/workerd "Address already in use"). */
export function reportsAddressInUse(output: string): boolean {
  return /EADDRINUSE|address already in use/i.test(output);
}

/** The ports this process handed out, so that two stacks of one worker never receive the same port. */
const handedOut = new Set<number>();

/** Asks the kernel for a free loopback port. The port is released before the caller binds it. */
function askKernel(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no loopback port was assigned'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/** Returns a free loopback port that this process has not handed out before. */
export async function freePort(ask: () => Promise<number> = askKernel): Promise<number> {
  for (let tries = 0; tries < 50; tries += 1) {
    const port = await ask();
    if (!handedOut.has(port)) {
      handedOut.add(port);
      return port;
    }
  }
  throw new Error('the kernel kept returning ports already handed out');
}

/**
 * Runs `start` and, when it fails with a `PortInUseError`, runs it again (its caller allocates new ports each time).
 * Any other error, and the last `PortInUseError`, is thrown as is.
 */
export async function retryOnPortInUse<T>(start: (attempt: number) => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await start(attempt);
    } catch (error) {
      if (!(error instanceof PortInUseError) || attempt >= attempts) {
        throw error;
      }
    }
  }
}

/**
 * Runs `make` on the first call and hands every later call the same promise, a failure included. The traced stacks of one
 * worker share one telemetry-site build, so the retry of a stack on new ports never builds the site again (UPK-10).
 */
export function onceAsync<T>(make: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;
  return () => (started ??= make());
}

/** The account id a signed-in player has, or an error that names the player (UPK-10: `openSiteFor` had no message). */
export function requireAccountId(name: string, accountId: string | undefined): string {
  if (accountId === undefined || accountId === '') {
    throw new Error(
      `"${name}" has no account id: sign the player in (world.sessionOf) before waiting for the stream`,
    );
  }
  return accountId;
}
