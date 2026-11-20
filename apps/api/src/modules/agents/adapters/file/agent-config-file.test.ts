import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENT_CONFIG_MAX_BYTES } from '@d2rmm/contracts';
import { AGENT_CONFIG_FILE, loadAgentConfig, parseAgentConfig, digestOf } from './agent-config-file.ts';

/**
 * The agent's built-in defaults (RCF-07), written down next to the Rust pinning tests of T10. The committed document
 * must carry exactly these values until a release changes one on purpose: a PC with the committed document reads as a PC
 * with none. `demoteAfter`, `probeEvery` and `rateWindow` are the capture cascade's constants (feat/F2-capture-cascade),
 * `lookIntervalMs` is `watch_screen::TICK`, `trackPad` is `hud_track::TRACK_PAD` and the words are the English pack.
 */
const AGENT_DEFAULTS = {
  cadence: { demoteAfter: 3, probeEvery: 60, rateWindow: 60, lookIntervalMs: 1000 },
  thresholds: { trackPad: 24 },
  regions: {},
  phrases: { en: { party: 'Party', gameName: 'Game Name', password: 'Password' } },
};

const directory = mkdtempSync(join(tmpdir(), 'agent-config-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

let counter = 0;
function fileWith(text: string): string {
  const path = join(directory, `config-${String(++counter)}.json`);
  writeFileSync(path, text);
  return path;
}

describe('the committed agent configuration (RCF-12)', () => {
  it('parses against the contract', () => {
    const served = loadAgentConfig();
    expect(served.version).toBe(1);
    expect(served.etag).toBe(`"agent-config-v1-${digestOf(served.body)}"`);
    expect(digestOf(served.body)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('holds exactly the agent defaults, at version 1', () => {
    const body = JSON.parse(loadAgentConfig().body) as unknown;
    expect(body).toStrictEqual({ version: 1, ...AGENT_DEFAULTS });
  });

  it('is served as the compact form of the file, under the 64 KiB limit', () => {
    const served = loadAgentConfig();
    expect(served.body).toBe(JSON.stringify(JSON.parse(served.body)));
    expect(Buffer.byteLength(served.body, 'utf8')).toBeLessThanOrEqual(AGENT_CONFIG_MAX_BYTES);
  });

  it('reads the file next to the module', () => {
    expect(AGENT_CONFIG_FILE.pathname.endsWith('/modules/agents/config/agent-config.json')).toBe(true);
  });
});

describe('parseAgentConfig', () => {
  it('tags the same version with another tag when the bytes change (an edit without a version bump)', () => {
    const first = parseAgentConfig('{"version":3}');
    const second = parseAgentConfig('{"version":3,"cadence":{"probeEvery":30}}');
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.version).toBe(second.value.version);
      expect(first.value.etag).not.toBe(second.value.etag);
    }
  });

  it('serves a document with only a version', () => {
    const parsed = parseAgentConfig('{"version": 7}');
    expect(parsed).toStrictEqual({
      ok: true,
      value: { version: 7, body: '{"version":7}', etag: `"agent-config-v7-${digestOf('{"version":7}')}"` },
    });
  });

  it('refuses a field outside the schema, at the top and inside a section', () => {
    expect(parseAgentConfig('{"version":1,"apiBase":"https://x.y"}')).toStrictEqual({
      ok: false,
      error: 'invalid',
    });
    expect(parseAgentConfig('{"version":1,"cadence":{"heartbeat":5}}')).toStrictEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('refuses a value outside its range and a phrase that looks like a pattern', () => {
    expect(parseAgentConfig('{"version":1,"cadence":{"lookIntervalMs":100}}')).toStrictEqual({
      ok: false,
      error: 'invalid',
    });
    expect(parseAgentConfig('{"version":1,"phrases":{"en":{"party":".*"}}}')).toStrictEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('refuses text that is not JSON, including an empty one', () => {
    expect(parseAgentConfig('{"version":')).toStrictEqual({ ok: false, error: 'not-json' });
    expect(parseAgentConfig('')).toStrictEqual({ ok: false, error: 'not-json' });
  });

  it('refuses a document over 64 KiB, even a valid one padded with spaces', () => {
    const padded = `{"version":1}${' '.repeat(AGENT_CONFIG_MAX_BYTES)}`;
    expect(parseAgentConfig(padded)).toStrictEqual({ ok: false, error: 'too-large' });
    const atLimit = `{"version":1}${' '.repeat(AGENT_CONFIG_MAX_BYTES - '{"version":1}'.length)}`;
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(AGENT_CONFIG_MAX_BYTES);
    expect(parseAgentConfig(atLimit).ok).toBe(true);
  });
});

describe('loadAgentConfig', () => {
  it('throws, naming the reason and never the content, for a file that fails', () => {
    expect(() => loadAgentConfig(fileWith('{"version":1,"secret":"hunter2"}'))).toThrow(
      /refused \(invalid\)/,
    );
    expect(() => loadAgentConfig(fileWith('{"version":1,"secret":"hunter2"}'))).not.toThrow(/hunter2/);
    expect(() => loadAgentConfig(fileWith('not json'))).toThrow(/refused \(not-json\)/);
  });

  it('throws for a file that does not exist', () => {
    expect(() => loadAgentConfig(join(directory, 'missing.json'))).toThrow();
  });
});
