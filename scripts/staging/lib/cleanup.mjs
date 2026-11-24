// How a bot leaves (staging-bots SBT-10): leave the room or the queue, delete the agent (which revokes its token), log the
// session out, close the streams. A failed step is logged and the rest still run; the result says which failed.

/**
 * @param {{ name: string, steps: Array<[string, () => Promise<unknown>]>, log: { line: Function } }} input
 * @returns {Promise<{ name: string, failed: string[] }>}
 */
export async function leave({ name, steps, log }) {
  const failed = [];
  for (const [step, run] of steps) {
    try {
      await run();
      log.line('bot.left-step', { bot: name, step });
    } catch (error) {
      failed.push(step);
      log.line('bot.left-step-failed', {
        bot: name,
        step,
        reason: error instanceof Error ? error.message : 'failed',
      });
    }
  }
  return { name, failed };
}

/** The exit code of a run: 0 when every step of every bot worked. */
export function exitCodeOf(results) {
  return results.some((result) => result.failed.length > 0) ? 1 : 0;
}
