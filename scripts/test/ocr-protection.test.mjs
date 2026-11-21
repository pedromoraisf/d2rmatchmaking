// ocr-protection (OCP-01, OCP-02, OCP-03, OCP-06): the reading modules are listed once, every one is mutated, every
// mutation exclusion carries its evidence, and the rule is where agents read first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultConfig,
  exclusionProblems,
  readingModuleProblems,
  readingModules,
} from '../agent/mutation-config.mjs';

const toml = readFileSync(defaultConfig, 'utf8');

test('the reading modules are the twelve domain modules and the four core modules (OCP-02)', () => {
  assert.deepEqual([...readingModules()].sort(), [
    'core/src/automap_name.rs',
    'core/src/chat_step.rs',
    'core/src/party.rs',
    'core/src/screen_reader.rs',
    'domain/src/anchors.rs',
    'domain/src/character_screen.rs',
    'domain/src/characters.rs',
    'domain/src/chat.rs',
    'domain/src/game_name_match.rs',
    'domain/src/hud_track.rs',
    'domain/src/language.rs',
    'domain/src/layout.rs',
    'domain/src/name_diff.rs',
    'domain/src/remote_config.rs',
    'domain/src/vision.rs',
    'domain/src/vocabulary.rs',
  ]);
});

test('every reading module exists and is mutated (OCP-02, OCP-03)', () => {
  assert.deepEqual(readingModuleProblems(toml), []);
});

test('a listed module outside the mutation scope, or missing, fails (OCP-02)', () => {
  const dropsParty = toml.replace('  "core/src/party.rs",\n', '');
  assert.deepEqual(readingModuleProblems(dropsParty), ['core/src/party.rs is outside examine_globs']);
  assert.deepEqual(readingModuleProblems(toml, ['domain/src/not_there.rs']), [
    'domain/src/not_there.rs does not exist',
  ]);
});

test('every mutation exclusion carries its file:line, its reason and its evidence (OCP-06)', () => {
  assert.deepEqual(exclusionProblems(toml), []);
});

test('an exclusion without evidence fails and is named (OCP-06)', () => {
  const noEvidence = toml.replace(/^# Evidence:.*\n# and .*\n/m, '');
  assert.notEqual(noEvidence, toml, 'the fixture dropped the evidence');
  assert.deepEqual(exclusionProblems(noEvidence), [
    'exclusion "delete ! in pair_once" lacks an "Evidence:" line',
  ]);

  const bare = toml.replace('  "delete ! in pair_once",\n', '  "delete ! in pair_once",\n  "x in y",\n');
  assert.notEqual(bare, toml, 'the fixture added a bare entry');
  assert.deepEqual(exclusionProblems(bare), [
    'exclusion "x in y" lacks a file:line, an "Evidence:" line, the reason',
  ]);
});

// OCP-01: the rule is where every agent reads first, and both copies name the list of reading modules.
const LIST = 'scripts/agent/reading-modules.json';

test('AGENTS.md and the feature worker name the list of reading modules and the pinning rule (OCP-01)', () => {
  for (const file of ['AGENTS.md', '.claude/agents/feature-worker.md']) {
    const text = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes(LIST), `${file} names ${LIST}`);
    assert.match(text, /pins? the current behaviour/, `${file} says survivors are killed by pinning tests`);
    assert.match(text, /Evidence:/, `${file} requires evidence for an exclusion`);
  }
});

test('AGENTS.md carries the rule as inviolable rule 14 (OCP-01)', () => {
  assert.match(readFileSync('AGENTS.md', 'utf8'), /^14\. \*\*OCR reading logic\*\*/m);
});

test('the skill states the merge rule for a changed reading module (OCP-07)', () => {
  const skill = readFileSync('.claude/skills/d2rmm-phase-runner/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  assert.match(skill, /`ocr-real` and `ocr-variations` green and the ratchet not regressing/);
  assert.match(skill, /before and after counts/);
});
