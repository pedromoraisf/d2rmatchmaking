// The plan of one bot run (staging-bots SBT-01, SBT-04, SBT-06, SBT-08). Pure: it validates the dispatch inputs and names
// the bots. It reads no environment and makes no request; every bound the spec sets is enforced here.

export const MAX_BOTS = 7;
export const MAX_MINUTES = 60;
export const DEFAULT_MINUTES = 15;
export const GROUP_SIZE = Object.freeze({ pvp: 2, leveling: 8 });

const MODES = ['pvp', 'leveling'];
const DIFFICULTIES = ['normal', 'nightmare', 'hell'];
const REGIONS = ['americas', 'europe', 'asia'];
const LADDERS = ['ladder', 'non-ladder'];
const ERAS = ['classic', 'lod', 'rotw'];
const ACTIVITIES = ['baal', 'chaos', 'cows', 'tz', 'heralds'];
// A bot never takes the teleporter role: the Leveling match hosts the teleporter (matcher.ts), and the human hosts.
const BOT_ROLES = ['bo', 'killer', 'leech'];
const RULES = ['gm', 'bm'];
const HOST_POLICIES = ['bot-reports', 'bot-silent'];
// The difficulty's level floor (QUE-03); the bots' characters are level 90, above every floor.
const LEVEL_FLOOR = { normal: 10, nightmare: 40, hell: 70 };
const TAG_PATTERN = /^[a-z0-9]{2}$/;
const CLASSES = [
  'sorceress',
  'paladin',
  'necromancer',
  'amazon',
  'barbarian',
  'druid',
  'assassin',
  'warlock',
];
const CHARACTER_WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];

export class PlanError extends Error {}

function oneOf(name, value, allowed, fallback) {
  const chosen = value === undefined || value === '' ? fallback : value;
  if (!allowed.includes(chosen)) {
    throw new PlanError(`${name} must be one of ${allowed.join(', ')}`);
  }
  return chosen;
}

function whole(name, value, min, max, fallback) {
  const chosen = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(chosen) || chosen < min || chosen > max) {
    throw new PlanError(`${name} must be a whole number from ${min} to ${max}`);
  }
  return chosen;
}

function flag(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new PlanError(`${name} must be true or false`);
}

/** The name of bot `number` (1-based) of the run `tag`: `bot-k7-3`. Starts with `bot-`, the bot's marker (SBT-04). */
export function botName(tag, number) {
  return `bot-${tag}-${number}`;
}

/** True for the name of a bot. A BattleTag holds no `-`, so a Battle.net display name never matches (SBT-04). */
export function isBotName(name) {
  return typeof name === 'string' && /^bot-/i.test(name);
}

/**
 * @param {Record<string, string | number | boolean | undefined>} input the dispatch inputs, as the workflow passes them
 * @param {string} tag two lowercase letters or digits that tell this run's bots from another run's
 */
export function buildPlan(input, tag) {
  if (!TAG_PATTERN.test(String(tag))) {
    throw new PlanError('the run tag is two lowercase letters or digits');
  }
  const mode = oneOf('mode', input.mode, MODES);
  const difficulty = oneOf('difficulty', input.difficulty, DIFFICULTIES);
  const region = oneOf('region', input.region, REGIONS, 'americas');
  const ladder = oneOf('ladder', input.ladder, LADDERS);
  const era = oneOf('era', input.era, ERAS);
  const hardcore = flag('hardcore', input.hardcore, false);
  const size = GROUP_SIZE[mode];
  const bots = whole('bots', input.bots, 1, Math.min(MAX_BOTS, size - 1), Math.min(MAX_BOTS, size - 1));
  const minutes = whole('minutes', input.minutes, 1, MAX_MINUTES, DEFAULT_MINUTES);
  const humanFirst = flag('human_first', input.human_first, true);
  const hostPolicy = oneOf('host_policy', input.host_policy, HOST_POLICIES, 'bot-reports');
  const queue =
    mode === 'pvp'
      ? { mode, difficulty, region, format: 'duel', rules: oneOf('rules', input.rules, RULES, 'gm') }
      : {
          mode,
          difficulty,
          region,
          activity: oneOf('activity', input.activity, ACTIVITIES),
          role: oneOf('role', input.role, BOT_ROLES, 'killer'),
          minLevel: whole('min_level', input.min_level, 1, 99, LEVEL_FLOOR[difficulty]),
        };
  if (mode === 'leveling' && queue.activity === 'heralds' && (difficulty !== 'hell' || era !== 'rotw')) {
    throw new PlanError('heralds needs hell and the rotw era (QUE-04)');
  }
  const members = Array.from({ length: bots }, (_, at) => ({
    number: at + 1,
    name: botName(tag, at + 1),
    character: {
      name: `Bot${CHARACTER_WORDS[at]}`,
      class: CLASSES[at % CLASSES.length],
      level: 90,
      hardcore,
      unlockedDifficulties: ['normal', 'nightmare', 'hell'],
    },
    declaration: { ladder, era },
  }));
  return { tag, size, bots: members, queue, minutes, humanFirst, hostPolicy };
}
