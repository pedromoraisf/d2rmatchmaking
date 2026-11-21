// Unit tests of the publication decision (AGR-06): a draft, a public release, an older tag.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareTags, decidePublication } from '../agent/publish-release.mjs';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agent',
  'publish-release.mjs',
);
const TAGS = ['agent-v0.0.2', 'agent-v0.3.0', 'agent-v0.4.0', 'agent-v0.10.0'];

test('versions compare as numbers, not as text', () => {
  assert.ok(compareTags('agent-v0.10.0', 'agent-v0.9.0') > 0);
  assert.ok(compareTags('agent-v0.3.0', 'agent-v1.0.0') < 0);
  assert.equal(compareTags('agent-v0.4.0', 'agent-v0.4.0'), 0);
  assert.throws(() => compareTags('v0.4.0', 'agent-v0.4.0'), /not an agent release tag/);
});

test('the newest draft is published as Latest', () => {
  assert.equal(decidePublication({ tag: 'agent-v0.10.0', isDraft: true, tags: TAGS }), 'latest');
});

test('a draft of an older tag is published without Latest', () => {
  assert.equal(decidePublication({ tag: 'agent-v0.4.0', isDraft: true, tags: TAGS }), 'not-latest');
});

test('a release that is already public is left alone, whatever its tag', () => {
  assert.equal(decidePublication({ tag: 'agent-v0.10.0', isDraft: false, tags: TAGS }), 'skip');
  assert.equal(decidePublication({ tag: 'agent-v0.3.0', isDraft: false, tags: TAGS }), 'skip');
});

test('a tag the list does not hold yet is still weighed against the others', () => {
  assert.equal(decidePublication({ tag: 'agent-v0.11.0', isDraft: true, tags: TAGS }), 'latest');
  assert.equal(decidePublication({ tag: 'agent-v0.1.0', isDraft: true, tags: [] }), 'latest');
});

test('tags that are not agent tags are ignored in the list and refused as the subject', () => {
  assert.equal(
    decidePublication({ tag: 'agent-v0.4.0', isDraft: true, tags: ['v9.9.9', 'site-v9.0.0'] }),
    'latest',
  );
  assert.throws(
    () => decidePublication({ tag: 'v9.9.9', isDraft: true, tags: [] }),
    /not an agent release tag/,
  );
});

test('the CLI reads git ls-remote lines and prints the decision', () => {
  const lsRemote = TAGS.map((tag, i) => `${String(i).repeat(40)}\trefs/tags/${tag}`).join('\n');
  const run = (tag, draft) =>
    spawnSync('node', [script, '--tag', tag, '--draft', draft, '--tags', lsRemote], { encoding: 'utf8' });
  assert.equal(run('agent-v0.10.0', 'true').stdout, 'latest\n');
  assert.equal(run('agent-v0.4.0', 'true').stdout, 'not-latest\n');
  assert.equal(run('agent-v0.4.0', 'false').stdout, 'skip\n');
  assert.notEqual(run('agent-v0.4.0', 'maybe').status, 0);
});
