import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_SCREEN, parseEventLines, prepareFixture } from './headless-agent.ts';

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('headless agent helper', () => {
  it('reads the events of the example output and skips other lines', () => {
    const output = [
      '{"event":"code","code":"123456"}',
      'not a json line',
      '{"event":"paired"}',
      '{"no":"event field"}',
      '',
      '{"event":"assignment","room":"mmbaalh-12"}',
    ].join('\n');

    expect(parseEventLines(output)).toStrictEqual([
      { event: 'code', code: '123456' },
      { event: 'paired' },
      { event: 'assignment', room: 'mmbaalh-12' },
    ]);
  });

  it('writes the fixture screen and its sidecar text, the game name the screen shows', () => {
    directory = mkdtempSync(path.join(tmpdir(), 'd2rmm-headless-test-'));
    const { png, sidecar } = prepareFixture(directory, 'mmbaalh-12');

    expect(existsSync(png)).toBe(true);
    expect(readFileSync(png).equals(readFileSync(FIXTURE_SCREEN))).toBe(true);
    expect(readFileSync(sidecar, 'utf8')).toBe('mmbaalh-12\n');
    expect(sidecar).toBe(`${png}.txt`);
  });
});
