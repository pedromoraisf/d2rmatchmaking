// The agent proves its OCR matching collision-free for the activities and difficulty codes the API can generate
// (apps/agent/src-tauri/domain/src/game_name_match.rs). This reads both sides as text, so a new API activity or code
// fails here until the agent's lists follow. It lives in the harness because the domain crate must not read the API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);

/** A repository file as text, with CRLF normalised to LF (Windows autocrlf). */
function source(relative) {
  return readFileSync(new URL(relative, root), 'utf8').replace(/\r\n/g, '\n');
}

function required(match, what) {
  assert.ok(match, `pattern not found: ${what}; update scripts/test/agent-game-name-drift.test.mjs`);
  return match;
}

const quoted = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);

const agent = source('apps/agent/src-tauri/domain/src/game_name_match.rs');

function agentList(name) {
  const match = required(
    agent.match(new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\];`)),
    `const ${name} in game_name_match.rs`,
  );
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

test('every activity the API can generate is in the agent collision list', () => {
  const union = required(
    source('apps/api/src/modules/matchmaking/domain/queue-ticket/queue-ticket.ts').match(
      /export type Activity =([^;]*);/,
    ),
    '`export type Activity =` in queue-ticket.ts',
  )[1];
  const api = [...quoted(union), 'pvp'];
  assert.ok(api.length > 1, 'the Activity union has members');
  const agentActivities = agentList('AGENT_ACTIVITIES');
  for (const activity of api) {
    assert.ok(
      agentActivities.includes(activity),
      `the API can generate \`${activity}\`: add it to AGENT_ACTIVITIES`,
    );
  }
});

test('every difficulty code the API can generate is in the agent collision list', () => {
  const body = required(
    source('apps/api/src/modules/lobby-room/domain/game-name.ts').match(
      /function difficultyCode[^{]*\{([\s\S]*?)\n\}\n/,
    ),
    '`function difficultyCode` in game-name.ts',
  )[1];
  const codes = [...body.matchAll(/return\s+('[^']*')/g)].flatMap((m) => quoted(m[1]));
  assert.ok(codes.length > 0, 'the API issues at least one difficulty code');
  const agentCodes = agentList('AGENT_DIFFICULTY_CODES');
  for (const code of codes) {
    assert.ok(
      agentCodes.includes(code),
      `the API can generate the code \`${code}\`: add it to AGENT_DIFFICULTY_CODES`,
    );
  }
});
