#!/usr/bin/env node
// The staging bots (staging-bots; ADR 032 XII, an admin task). It puts synthetic players in the staging queue so a lone
// tester reaches a ready check and a room. Never production: `assertStaging` runs before any write (SBT-02). Started by the
// `staging-bots` workflow; reads its settings only in `config.mjs`.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig, tagOf } from './config.mjs';
import { createBot } from './lib/bot.mjs';
import { leave, exitCodeOf } from './lib/cleanup.mjs';
import { createClient } from './lib/http.mjs';
import { createLog, summaryOf } from './lib/log.mjs';
import { buildPlan } from './lib/plan.mjs';
import { assertStaging } from './lib/target.mjs';

const POLL_MS = 5_000;

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Runs the bots and returns the exit code. Everything it touches is an argument, so a test can run it on a fake API. */
export async function run({
  config,
  fetch: send,
  write,
  sleep = abortableSleep,
  random = Math.random,
  signal,
  writeSummary,
}) {
  const log = createLog({ write });
  let plan;
  let target;
  try {
    target = await assertStaging({ ...config, fetch: send });
    plan = buildPlan(config.inputs, tagOf(config.runId));
    if (config.siteOrigin === undefined || config.siteOrigin === '')
      throw new Error('SITE_ORIGIN is not set');
  } catch (error) {
    log.line('run.refused', { reason: error instanceof Error ? error.message : 'refused' });
    return 2;
  }
  const client = createClient({
    base: target.origin,
    origin: config.siteOrigin,
    version: target.minAgentVersion,
    fetch: send,
    sleep,
  });
  const stop = new AbortController();
  const deadline = setTimeout(() => stop.abort(), plan.minutes * 60_000);
  signal?.addEventListener('abort', () => stop.abort(), { once: true });
  const bots = plan.bots.map((member) =>
    createBot({
      member,
      plan,
      client,
      base: target.origin,
      fetch: send,
      log,
      sleep,
      random,
      signal: stop.signal,
    }),
  );
  log.line('run.started', {
    bots: bots.map((bot) => bot.name),
    humanFirst: plan.humanFirst,
    minutes: plan.minutes,
  });
  let code = 0;
  try {
    for (const bot of bots) {
      await bot.provision();
      bot.start();
    }
    const [sentinel, ...others] = bots;
    if (plan.humanFirst) {
      await sentinel.join();
      // The API counts a bucket only for an account that holds a ticket, so the first bot waits and reads it (A1 of notes.md).
      while (!stop.signal.aborted) {
        const pool = await sentinel.poolSize();
        if (pool === undefined || pool - 1 >= 1) break;
        await sleep(POLL_MS, stop.signal);
      }
      if (stop.signal.aborted) log.line('run.no-human', { waitedMinutes: plan.minutes });
    } else {
      await sentinel.join();
    }
    if (!stop.signal.aborted) {
      for (const bot of others) await bot.join();
    }
    await Promise.race([
      Promise.all(bots.map((bot) => bot.ended)),
      new Promise((resolve) => stop.signal.addEventListener('abort', resolve, { once: true })),
    ]);
  } catch (error) {
    code = 1;
    log.line('run.failed', { reason: error instanceof Error ? error.message : 'failed' });
  } finally {
    clearTimeout(deadline);
    stop.abort();
    const results = [];
    for (const bot of bots) results.push(await leave({ name: bot.name, steps: bot.leaveSteps(), log }));
    const outcomes = bots.map((bot) => ({
      ...bot.outcome(),
      left: results.find((result) => result.name === bot.name)?.failed.length ? 'with failures' : 'clean',
    }));
    writeSummary?.(summaryOf({ plan, outcomes, scrub: log.scrub }));
    code = Math.max(code, exitCodeOf(results));
    log.line('run.finished', { code });
  }
  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const interrupt = new AbortController();
  for (const signalName of ['SIGINT', 'SIGTERM']) process.on(signalName, () => interrupt.abort());
  const code = await run({
    config,
    fetch: globalThis.fetch,
    write: (text) => process.stdout.write(text),
    signal: interrupt.signal,
    writeSummary: config.summaryPath ? (text) => appendFileSync(config.summaryPath, text) : undefined,
  });
  process.exit(code);
}
