/**
 * The scheduled jobs of the process that write to the database (matcher, room and agent sweeps, site-closed drops),
 * tracked so the acceptance reset can stop them before it truncates. A job that is still writing when the truncate
 * starts holds locks the truncate queues behind, and its next statement queues behind the truncate: Postgres ends that
 * as a deadlock (40P01) after one second, and the reset answers 503. The acceptance clock moves only when a step moves
 * it, so the jobs a scenario's clock advance started run on after the step returned, into the next scenario's reset.
 */
export class BackgroundWork {
  readonly #running = new Set<Promise<unknown>>();
  #paused = false;

  /** Starts `job` unless paused. Returns false when it did not start. A failure is the job's own to handle. */
  run(job: () => Promise<unknown>): boolean {
    if (this.#paused) {
      return false;
    }
    const tracked: Promise<unknown> = job().then(
      () => undefined,
      () => undefined,
    );
    this.#running.add(tracked);
    void tracked.finally(() => this.#running.delete(tracked));
    return true;
  }

  /** Refuses new jobs, then resolves once every job that started has ended. Call `resume` after. */
  async pause(): Promise<void> {
    this.#paused = true;
    while (this.#running.size > 0) {
      await Promise.all([...this.#running]);
    }
  }

  resume(): void {
    this.#paused = false;
  }
}
