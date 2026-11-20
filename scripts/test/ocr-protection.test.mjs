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

test('the reading modules are the nine domain modules and the two core modules (OCP-02)', () => {
  assert.deepEqual([...readingModules()].sort(), [
    'core/src/party.rs',
    'core/src/screen_reader.rs',
    'domain/src/anchors.rs',
    'domain/src/character_screen.rs',
    'domain/src/characters.rs',
    'domain/src/game_name_match.rs',
    'domain/src/language.rs',
    'domain/src/layout.rs',
    'domain/src/name_diff.rs',
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

  const bare = toml.replace(
    'exclude_re = ["delete ! in pair_once"]',
    'exclude_re = [\n  "delete ! in pair_once",\n  "x in y",\n]',
  );
  assert.deepEqual(exclusionProblems(bare), [
    'exclusion "x in y" lacks a file:line, an "Evidence:" line, the reason',
  ]);
});
