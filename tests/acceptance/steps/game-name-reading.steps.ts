// The agent reads the room's game name on the automap and tells names that differ only in their difficulty code
// (game-name-reading, GNR-02, GNR-06). The agent is the headless example the Party steps start (agent-game-name): the real
// agent core and its screen loop, reading a drawn fixture whose sidecar holds the text and the box of each line. The automap
// frames are the ones `xtask draw-fixture automap-name` draws (a picture and its lines at the measured position of the name
// line); a step copies one, sets the name of its line, and shows it to the agent. How well the real font is read is proved
// elsewhere (`ocr-real`, unit tests): these scenarios prove the route, the match and that one run reports once. The steps are
// black box: the API over HTTP and the example's stdout.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Then, When } from '../fixtures.ts';
import { AUTOMAP_NAME_FIXTURE_DIR, setPartyPanel } from '../support/headless-agent.ts';
import type { World } from '../support/world.ts';
import { partyAgentOf, roomNameOfHost } from './agent-game-name.steps.ts';

/** A generated game name: `mm`, the activity, the difficulty code, `-`, the run number (ADR 017). */
const GENERATED_NAME = /^mm([a-z]+?)([nmh])-(\d+)$/u;
/** The field of a masked Party panel: the panel is not revealed. */
const MASKED_FIELD = /^x+$/iu;
/** Two reads of the agent's loop (it reads once a second) and a margin. */
const TWO_READS_MS = 2_500;

/** One line of a drawn frame's sidecar: its text and its box. */
interface FixtureLine {
  readonly text: string;
  readonly [key: string]: unknown;
}

/** The activity and the difficulty code of a generated game name. */
function partsOf(name: string): { activity: string; code: string } {
  const parts = GENERATED_NAME.exec(name);
  if (parts?.[1] === undefined || parts[2] === undefined) {
    throw new Error(`"${name}" is not a generated game name`);
  }
  return { activity: parts[1], code: parts[2] };
}

/**
 * Shows the agent the drawn automap frame `fixture` with `name` on its name line. When the Party panel is revealed in the
 * scenario, the panel is still shown: the frame carries the panel's lines too, as one screen can show both.
 */
function showAutomap(world: World, fixture: string, name: string): void {
  const { agent, dir, png } = partyAgentOf(world);
  const source = path.join(AUTOMAP_NAME_FIXTURE_DIR, `${fixture}.png`);
  const shown = path.join(dir, 'automap-name.png');
  copyFileSync(source, shown);
  const drawn = JSON.parse(readFileSync(`${source}.json`, 'utf8')) as { lines: FixtureLine[] };
  const [first, ...others] = drawn.lines;
  if (first === undefined) throw new Error(`the fixture ${fixture} draws no name line`);
  const label = first.text.split(': ')[0] ?? '';
  const lines = [{ ...first, text: `${label}: ${name}` }, ...others];
  const panel = JSON.parse(readFileSync(`${png}.json`, 'utf8')) as Record<string, string>;
  const revealed = panel['gameNameField'] !== undefined && !MASKED_FIELD.test(panel['gameNameField']);
  const panelKeys = revealed
    ? {
        partyTitle: panel['partyTitle'],
        gameNameLabel: panel['gameNameLabel'],
        gameNameField: panel['gameNameField'],
      }
    : {};
  writeFileSync(`${shown}.json`, `${JSON.stringify({ ...panelKeys, lines }, null, 2)}\n`);
  agent.show(shown);
}

// GNR-02: the Party panel shows the room's name with another difficulty code: a different game, never reported.
When(
  /^the game shows the Party panel with the room's game name but the difficulty code "([nmh])"$/u,
  ({ world }, code: string) => {
    const room = roomNameOfHost(world);
    const { activity, code: own } = partsOf(room);
    expect(code, `the code must differ from the room's own "${own}"`).not.toBe(own);
    const other = room.replace(`mm${activity}${own}-`, `mm${activity}${code}-`);
    expect(other, 'the name with the other code').not.toBe(room);
    setPartyPanel(partyAgentOf(world).png, { gameNameField: other });
  },
);

// GNR-06: the automap shows the room's name (the drawn frame of its activity and code).
When("the game shows the automap with the room's game name", ({ world }) => {
  const room = roomNameOfHost(world);
  const { activity, code } = partsOf(room);
  showAutomap(world, `automap-${activity}${code}`, room);
});

// GNR-06: the automap shows another game's name.
When(/^the game shows the automap with the game name "(.+)"$/u, ({ world }, name: string) => {
  showAutomap(world, 'automap-other-room', name);
});

// GNR-06: the run is reported once, whichever source read it first.
Then("the agent has reported the room's game name once", async ({ world }) => {
  const { agent } = partyAgentOf(world);
  await expect
    .poll(() => agent.observedTimes().length, { timeout: 10_000, message: 'the first observation' })
    .toBeGreaterThanOrEqual(1);
  await new Promise((resolve) => setTimeout(resolve, TWO_READS_MS));
  expect(agent.observedTimes().length, 'the observations the agent posted').toBe(1);
});
