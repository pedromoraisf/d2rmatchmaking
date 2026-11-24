import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botName, buildPlan, isBotName, PlanError } from '../staging/lib/plan.mjs';

const pvp = { mode: 'pvp', difficulty: 'hell', ladder: 'ladder', era: 'rotw' };
const leveling = {
  mode: 'leveling',
  difficulty: 'hell',
  ladder: 'non-ladder',
  era: 'rotw',
  activity: 'baal',
};

test('SBT-06 a duel takes one bot, Leveling seven, and the defaults are the group size minus one', () => {
  assert.equal(buildPlan(pvp, 'k7').bots.length, 1);
  assert.equal(buildPlan(leveling, 'k7').bots.length, 7);
  assert.equal(buildPlan(leveling, 'k7').size, 8);
});

test('SBT-06 bots are capped at the group size minus one, so they can never form a group alone', () => {
  assert.throws(() => buildPlan({ ...pvp, bots: 2 }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...leveling, bots: 8 }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...leveling, bots: 0 }, 'k7'), PlanError);
  assert.equal(buildPlan({ ...leveling, bots: '3' }, 'k7').bots.length, 3);
});

test('SBT-08 minutes are 1 to 60 and default to 15', () => {
  assert.equal(buildPlan(pvp, 'k7').minutes, 15);
  assert.throws(() => buildPlan({ ...pvp, minutes: 61 }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...pvp, minutes: 0 }, 'k7'), PlanError);
});

test('SBT-04 a bot name starts with bot-, is a valid test name, and only such names read as bots', () => {
  const names = buildPlan(leveling, 'k7').bots.map((bot) => bot.name);
  assert.deepEqual(names.slice(0, 2), ['bot-k7-1', 'bot-k7-2']);
  for (const name of names) {
    assert.match(name, /^[A-Za-z0-9-]{2,16}$/);
    assert.equal(isBotName(name), true);
  }
  assert.equal(botName('ab', 3), 'bot-ab-3');
  assert.equal(isBotName('Alice'), false);
  assert.equal(isBotName('robot-1'), false);
});

test('SBT-05 each bot has a character the contract accepts, named with letters only and starting with Bot', () => {
  for (const bot of buildPlan(leveling, 'k7').bots) {
    assert.match(bot.character.name, /^Bot[A-Za-z]+$/);
    assert.equal(bot.character.level, 90);
  }
});

test('SBT-06 a bot never takes the teleporter role, and the human hosts', () => {
  assert.throws(() => buildPlan({ ...leveling, role: 'teleporter' }, 'k7'), PlanError);
  assert.equal(buildPlan(leveling, 'k7').queue.role, 'killer');
});

test('SBT-01 an input outside its set fails before any request, and heralds needs hell and rotw', () => {
  assert.throws(() => buildPlan({ ...pvp, mode: 'arena' }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...pvp, difficulty: 'easy' }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...pvp, region: 'mars' }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...leveling, activity: 'heralds', difficulty: 'normal' }, 'k7'), PlanError);
  assert.throws(() => buildPlan({ ...leveling, activity: undefined }, 'k7'), PlanError);
  assert.throws(() => buildPlan(pvp, 'KK'), PlanError);
});

test('SBT-01 human first is the default and the host policy is bot-reports', () => {
  const plan = buildPlan(pvp, 'k7');
  assert.equal(plan.humanFirst, true);
  assert.equal(plan.hostPolicy, 'bot-reports');
  assert.equal(
    buildPlan({ ...pvp, human_first: 'false', host_policy: 'bot-silent' }, 'k7').humanFirst,
    false,
  );
  assert.throws(() => buildPlan({ ...pvp, host_policy: 'robot' }, 'k7'), PlanError);
});

test('SBT-01 the queue body of each mode carries the fields the contract requires', () => {
  assert.deepEqual(buildPlan(pvp, 'k7').queue, {
    mode: 'pvp',
    difficulty: 'hell',
    region: 'americas',
    format: 'duel',
    rules: 'gm',
  });
  assert.equal(buildPlan(leveling, 'k7').queue.minLevel, 70);
});
