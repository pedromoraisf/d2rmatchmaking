#!/usr/bin/env node
// PreToolUse gate hook. Registered in .claude/settings.json for Bash, file-editing and subagent tools.
// Fails closed on its own bugs: an exception becomes "ask", never a silent allow.
// Applies retry-budget effects (ADR 022) to the shared ledger in .git/d2rmm/ledger.json, the call history of the
// polling rule (GPR-17) to history.json next to it, and the verdict effects to verdicts.json.
//
// gate-precision (GPR-20, GPR-21): an 8 s watchdog answers `ask` when the call stalls; a call over 100 MB asks before
// anything is parsed; a rule module loads only for the calls that need it; every I/O of the call shares one deadline
// (io.mjs). Log lines never hold the command or the raw input.
import * as nodeFs from 'node:fs';
import path from 'node:path';
import { DEADLINE_MS, gitLocations, makeIo, makeRepoContext, projectDir, toRelative } from './lib/io.mjs';
import { BASELINE, decide } from './lib/gate-rules.mjs';
import { recordAttempt, recordDispatch } from '../../scripts/lib/budget.mjs';
import { ledgerPath, loadLedger, withLedger } from '../../scripts/lib/ledger-store.mjs';
import { applyVerdictEffects, loadVerdicts, verdictsPath } from './lib/verdict-store.mjs';
import { applyHistoryEffect, historyPath, loadHistory, withHistory } from './lib/history-store.mjs';

const WATCHDOG_MS = 8_000;
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
// The same shape as gate-rules' MUTATION_RUN: only a line that names a mutation runner can need mutation-scope.
const MUTATION_HINT = /mutate\.py|check_proofs\.py/;

// Each rule module has its own import(), so a call that does not need one never evaluates it (GPR-21).
const LOADERS = {
  ratchet: () => import('../../scripts/lib/ratchet.mjs'),
  acceptance: () => import('../../scripts/lib/acceptance.mjs'),
  mutationScope: () => import('../../scripts/lib/mutation-scope.mjs'),
  modelPolicy: () => import('../../scripts/lib/model-policy.mjs'),
};

const TOO_BIG = Symbol('input over 100 MB');
let answered = false;

/** Writes this call's one answer (nothing for no opinion) and exits 0. A second call is a no-op. */
function answer(decision, reason) {
  if (answered) return;
  answered = true;
  if (decision) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: `[d2rmm gate] ${reason}`,
        },
      }),
    );
  }
  process.exit(0);
}

/** A log line with fixed text only: never the command, never the raw input. */
const log = (line) => process.stderr.write(`[d2rmm gate] ${line}\n`);

// GPR-20: armed before anything else can stall (stdin, an import()). A synchronous block is bounded by the I/O deadline.
setTimeout(() => {
  log('the call was not answered in time');
  answer('ask', 'The gate ran out of time, so it asks instead of allowing.');
}, WATCHDOG_MS);

/** All of stdin as one Buffer. Over 100 MB it keeps draining, so the pipe is not cut, and answers TOO_BIG. */
async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes <= MAX_INPUT_BYTES) chunks.push(chunk);
  }
  return bytes > MAX_INPUT_BYTES ? TOO_BIG : Buffer.concat(chunks);
}

/** The parsed call: `{}` for empty stdin, undefined when the text is not a JSON object. Parsed once. */
function parseCall(raw) {
  const text = raw.toString('utf8').trim();
  if (text === '') return {};
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The rule modules a call needs (GPR-21). A rule whose module is missing asks, so this may only name a superset. */
function neededModules(input) {
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  const needed = new Set();
  if (tool === 'Bash' && MUTATION_HINT.test(String(ti.command ?? ''))) needed.add('mutationScope');
  if (EDIT_TOOLS.has(tool)) {
    const file = String(ti.file_path ?? ti.notebook_path ?? '');
    if (path.basename(file) === BASELINE) needed.add('ratchet');
    if (file.endsWith('.feature')) needed.add('acceptance');
  }
  if (DISPATCH_TOOLS.has(tool)) needed.add('modelPolicy');
  return needed;
}

async function loadModules(names) {
  const modules = {};
  for (const name of names) modules[name] = await LOADERS[name]();
  return modules;
}

/** The largest content an edit carries, in bytes: a Write's content, an Edit's strings, a MultiEdit's edits. */
function largestContent(ti) {
  const strings = [ti.content, ti.new_string, ti.old_string, ti.new_source];
  for (const e of Array.isArray(ti.edits) ? ti.edits : []) strings.push(e?.new_string, e?.old_string);
  return Math.max(0, ...strings.map((s) => (typeof s === 'string' ? Buffer.byteLength(s) : 0)));
}

/** The same call with its content emptied: the path rules judge it, the content is not read. */
function withoutContent(input) {
  return {
    ...input,
    tool_input: {
      ...input.tool_input,
      content: '',
      new_string: '',
      old_string: '',
      new_source: '',
      edits: [],
    },
  };
}

/** A relative path read whole, from a descriptor that is a regular file (a FIFO is never read); null when absent. */
function readWhole(abs) {
  let fd;
  try {
    fd = nodeFs.openSync(abs, nodeFs.constants.O_RDONLY | nodeFs.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    return nodeFs.fstatSync(fd).isFile() ? nodeFs.readFileSync(fd, 'utf8') : null;
  } catch {
    return null;
  } finally {
    nodeFs.closeSync(fd);
  }
}

/**
 * The context the rules judge with. Every I/O goes through one bounded `io` (GPR-20): a timed-out call is
 * `{ timedOut: true }` for the read-only walk, which checks for it, and null for the older rules, which read null as
 * "no answer".
 */
function contextFor(root, io, modules) {
  const base = makeRepoContext(root);
  const text = (r) => (typeof r === 'string' ? r : null);
  // The read-only rule calls `git(args, { cwd })`; the older rules call `git(...args)`.
  const git = (...called) =>
    Array.isArray(called[0])
      ? io.git(called[0], { cwd: called[1]?.cwd ?? root })
      : text(io.git(called, { cwd: root }));
  return {
    ...base,
    modules,
    git,
    realpath: io.realpath,
    stat: io.stat,
    // Scripts outside the checkout are absolute paths: read bounded (1 MB, one link, a regular file).
    readFile: (p) => {
      if (path.isAbsolute(p)) return io.readFile(p);
      const abs = path.join(root, p);
      return io.stat(abs)?.timedOut ? null : readWhole(abs);
    },
    isTracked: (rel) => text(io.git(['ls-files', '--error-unmatch', '--', rel], { cwd: root })) !== null,
    // GPR-22: the branch from the git files; git only when they do not say.
    currentBranch: () =>
      gitLocations(root)?.branch ?? text(io.git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })),
    headTime(dir) {
      const args = dir ? ['-C', dir, 'log', '-1', '--format=%ct'] : ['log', '-1', '--format=%ct'];
      const t = text(io.git(args, { cwd: root }));
      return t ? Number(t) : null;
    },
    nowMs: () => Date.now(),
  };
}

/** Applies the effects of a decision: the ledger, the verdicts and the call history, each under its own lock. */
function applyEffects(root, effects) {
  const ledgerEffects = effects.filter((e) => e.op === 'fail' || e.op === 'dispatch');
  if (ledgerEffects.length) {
    withLedger(ledgerPath(root), (ledger) => {
      for (const e of ledgerEffects) {
        if (e.op === 'fail') recordAttempt(ledger, e.key, false, { note: e.note });
        else recordDispatch(ledger, e.key, { note: e.note });
      }
    });
  }
  // ADR 028 § 3: the head a security review starts on (HBS-26), written under the verdict store's lock.
  applyVerdictEffects(
    verdictsPath(root),
    effects.filter((e) => e.op === 'note'),
  );
  const historyEffects = effects.filter((e) => e.op === 'history');
  if (historyEffects.length) {
    withHistory(
      historyPath(root),
      (store) => {
        for (const e of historyEffects) applyHistoryEffect(store, e);
      },
      { now: Date.now() },
    );
  }
}

async function main() {
  const raw = await readStdin();
  if (raw === TOO_BIG) {
    log('the call is over 100 MB');
    return answer('ask', 'The call is over 100 MB, so the gate asks instead of reading it (GPR-20).');
  }
  const input = parseCall(raw);
  if (input === undefined) {
    log('the call is not a JSON object');
    return answer('ask', 'The gate could not read the call. Asking instead of allowing.');
  }
  const root = projectDir(input);
  let result;
  try {
    const io = makeIo({ now: Date.now, deadlineMs: DEADLINE_MS });
    const ctx = contextFor(root, io, await loadModules(neededModules(input)));
    ctx.ledger = loadLedger(ledgerPath(root), root);
    ctx.verdicts = loadVerdicts(verdictsPath(root)); // the merge guard reads the proofs (HBS-27/28)
    ctx.history = loadHistory(historyPath(root));
    const ti = input.tool_input ?? {};
    if (EDIT_TOOLS.has(input.tool_name) && largestContent(ti) > MAX_CONTENT_BYTES) {
      // GPR-20: a content rule never judges a part of a huge content. Only a path deny stands; otherwise it asks.
      const byPath = decide(withoutContent(input), ctx, toRelative);
      result =
        byPath?.decision === 'deny'
          ? byPath
          : {
              decision: 'ask',
              reason:
                'The new content is over 10 MB, so the gate cannot judge it. Asking instead of allowing (GPR-20).',
            };
    } else {
      result = decide(input, ctx, toRelative);
    }
    applyEffects(root, result?.effects ?? []);
  } catch (err) {
    result = {
      decision: 'ask',
      reason: `Gate hook error (${err?.message ?? err}). Asking instead of allowing.`,
    };
  }
  return answer(result?.decision ?? null, result?.reason ?? '');
}

main().catch(() => answer('ask', 'Gate hook error. Asking instead of allowing.'));
