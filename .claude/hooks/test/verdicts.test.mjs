// HBS-26 to HBS-29 and HBS-45: the security reviewer's verdict is noted at its start and recorded at its end, at the
// head the review started on, and only an exact `VERDICT: PASS` at an unmoved head is a PASS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyVerdictEffect,
  latestVerdict,
  noteDispatch,
  recordVerdict,
  responseText,
  verdictOf,
} from '../lib/verdicts.mjs';
import { emptyVerdicts, loadVerdicts, withVerdicts } from '../lib/verdict-store.mjs';

const BRANCH = 'feat/F0-gate-precision';
const NOW = '2026-11-07T10:00:00Z';
const FILES = {
  '.specs/phases/ACTIVE': 'F0\n',
  '.specs/phases/F0/brief.md': '## Approval\n\n**Approved**: 2026-11-07 - user: "aprovo"\n',
};

/** A context whose feature branch points at `head`. The verdicts are the store the hooks would have loaded. */
function ctxAt(head, verdicts = emptyVerdicts()) {
  const heads = { [BRANCH]: head };
  return {
    root: '/repo',
    mainRoot: '/repo',
    readFile: (rel) => (rel in FILES ? FILES[rel] : null),
    readMainFile: (rel) => (rel in FILES ? FILES[rel] : null),
    git: (...args) => heads[args.at(-1)] ?? null,
    now: () => NOW,
    verdicts,
  };
}

const review = (
  id,
  prompt = '[d2rmm feature=gate-precision step=review-diff] review the diff',
  extra = {},
) => ({
  tool_name: 'Agent',
  tool_use_id: id,
  tool_input: { subagent_type: 'security-reviewer', prompt, run_in_background: false, ...extra },
});
const ended = (id, tool_response, tool_name = 'Agent') => ({ tool_name, tool_use_id: id, tool_response });

/** Start a review at `head`, then end it with `response` at `endHead`; returns the store. */
function reviewOf(response, { head = 'abc1', endHead = head } = {}) {
  let store = emptyVerdicts();
  store = applyVerdictEffect(store, noteDispatch(review('u1'), ctxAt(head)));
  const effect = recordVerdict(ended('u1', response), ctxAt(endHead, store));
  return applyVerdictEffect(store, effect);
}

test('records a PASS at the head the review started on', () => {
  const store = reviewOf('No blocking findings.\n\nVERDICT: PASS');
  assert.deepEqual(store.verdicts, [{ feature: 'gate-precision', head: 'abc1', verdict: 'PASS', at: NOW }]);
  assert.deepEqual(store.notes, {}, 'the pending note is dropped with its verdict');
  assert.equal(latestVerdict(store, 'gate-precision', 'abc1').verdict, 'PASS');
});

test('records a FAIL for every report that is not exactly PASS', () => {
  const reports = [
    'VERDICT: FAIL',
    'VERDICT: PASS\nthen the second part\nVERDICT: FAIL',
    'VERDICT: PASS with two findings left',
    'I ran out of time.',
    '',
  ];
  for (const report of reports) {
    assert.equal(reviewOf(report).verdicts[0].verdict, 'FAIL', JSON.stringify(report));
  }
  for (const unreadable of [{ foo: 1 }, [], null, { content: [] }, 42]) {
    assert.equal(reviewOf(unreadable).verdicts[0].verdict, 'FAIL', JSON.stringify(unreadable));
  }
});

test('records a FAIL when the branch moved during the review', () => {
  const store = reviewOf('VERDICT: PASS', { head: 'abc1', endHead: 'def2' });
  assert.deepEqual(store.verdicts, [{ feature: 'gate-precision', head: 'abc1', verdict: 'FAIL', at: NOW }]);
  assert.equal(
    latestVerdict(store, 'gate-precision', 'def2'),
    null,
    'no verdict is recorded at the moved head',
  );
});

test('records nothing for other dispatches', () => {
  const others = [
    {
      tool_name: 'Agent',
      tool_use_id: 'a',
      tool_input: {
        subagent_type: 'architecture-reviewer',
        prompt: '[d2rmm feature=gate-precision step=review-diff] review the diff',
      },
    },
    {
      tool_name: 'Agent',
      tool_use_id: 'b',
      tool_input: {
        subagent_type: 'security-reviewer',
        prompt: '[d2rmm feature=gate-precision step=review-security] review it',
      },
    },
    {
      tool_name: 'Agent',
      tool_use_id: 'c',
      tool_input: { subagent_type: 'security-reviewer', prompt: 'review the diff of gate-precision' },
    },
    {
      tool_name: 'Agent',
      tool_use_id: 'd',
      tool_input: {
        subagent_type: 'feature-worker',
        prompt: '[d2rmm feature=gate-precision step=execute-batch-1] build',
      },
    },
  ];
  for (const input of others) {
    assert.equal(noteDispatch(input, ctxAt('abc1')), null, input.tool_input.subagent_type);
  }
  // Their PostToolUse calls find no note and record nothing.
  for (const input of [...others, ended('never-noted', 'VERDICT: PASS')]) {
    assert.equal(recordVerdict(input, ctxAt('abc1')), null, input.tool_use_id);
  }
});

test('a review that never returned leaves no verdict', () => {
  const store = applyVerdictEffect(emptyVerdicts(), noteDispatch(review('u1'), ctxAt('abc1')));
  assert.equal(Object.keys(store.notes).length, 1, 'the note is there');
  assert.deepEqual(store.verdicts, [], 'the note alone is no verdict');
  assert.equal(latestVerdict(store, 'gate-precision', 'abc1'), null);
});

test('reads the PostToolUse payload fixtures', () => {
  const fixtureDir = new URL('../../../scripts/test/fixtures/hooks/', import.meta.url);
  for (const name of ['agent-post-tool-use.json', 'agent-post-tool-use-agent.json']) {
    const payload = JSON.parse(readFileSync(new URL(name, fixtureDir), 'utf8'));
    let store = applyVerdictEffect(emptyVerdicts(), noteDispatch(payload, ctxAt('abc1')));
    const effect = recordVerdict(payload, ctxAt('abc1', store));
    store = applyVerdictEffect(store, effect);
    assert.equal(store.verdicts.length, 1, name);
    assert.equal(store.verdicts[0].verdict, 'PASS', name);
    assert.equal(store.verdicts[0].feature, 'gate-precision', name);
  }
});

test('reads the text of every tool_response form, and only exact PASS lines are PASS', () => {
  assert.equal(responseText('a'), 'a');
  assert.equal(responseText({ content: [{ type: 'text', text: 'a' }] }), 'a');
  assert.equal(
    responseText([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]),
    'a\nb',
  );
  assert.equal(responseText([{ type: 'image' }]), null);
  assert.equal(verdictOf('x\n  VERDICT: PASS  '), 'PASS');
  assert.equal(verdictOf('x\nVERDICT: pass'), 'FAIL');
});

test('the store writes verdicts.json and reads it back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'd2rmm-verdicts-'));
  const file = path.join(dir, 'd2rmm', 'verdicts.json');
  withVerdicts(file, (store) => applyVerdictEffect(store, noteDispatch(review('u1'), ctxAt('abc1'))));
  assert.equal(loadVerdicts(file).notes.u1.head, 'abc1');
  assert.deepEqual(loadVerdicts(path.join(dir, 'missing.json')), emptyVerdicts());
});
