import { describe, expect, it } from 'vitest';
import {
  AGENT_CONFIG_MAX_BYTES,
  AGENT_CONFIG_RANGES,
  AgentConfig,
  AgentConfigResponse,
} from './agent-config.ts';

const valid = (config: unknown): boolean => AgentConfig.safeParse(config).success;

describe('AgentConfig ranges (RCF-03)', () => {
  const cadenceFields = [
    'demoteAfter',
    'probeEvery',
    'rateWindow',
    'lookIntervalMs',
    'automapSearchEvery',
    'listSearchEvery',
  ] as const;
  for (const field of cadenceFields) {
    const { min, max } = AGENT_CONFIG_RANGES[field];
    it(`accepts ${field} at ${min} and ${max}, refuses ${min - 1} and ${max + 1} and a fraction`, () => {
      expect(valid({ version: 1, cadence: { [field]: min } })).toBe(true);
      expect(valid({ version: 1, cadence: { [field]: max } })).toBe(true);
      expect(valid({ version: 1, cadence: { [field]: min - 1 } })).toBe(false);
      expect(valid({ version: 1, cadence: { [field]: max + 1 } })).toBe(false);
      expect(valid({ version: 1, cadence: { [field]: min + 0.5 } })).toBe(false);
    });
  }

  it("keeps the search cadences at today's floor of 2: no configuration searches more often (RCF-09)", () => {
    expect(AGENT_CONFIG_RANGES.automapSearchEvery).toEqual({ min: 2, max: 10 });
    expect(AGENT_CONFIG_RANGES.listSearchEvery).toEqual({ min: 2, max: 10 });
    expect(valid({ version: 1, cadence: { automapSearchEvery: 1 } })).toBe(false);
    expect(valid({ version: 1, cadence: { listSearchEvery: 1 } })).toBe(false);
  });

  it('keeps the look interval at one second or more (CHR-03)', () => {
    expect(AGENT_CONFIG_RANGES.lookIntervalMs.min).toBe(1000);
    expect(valid({ version: 1, cadence: { lookIntervalMs: 999 } })).toBe(false);
  });

  it('accepts trackPad at both ends and refuses a value outside', () => {
    const { min, max } = AGENT_CONFIG_RANGES.trackPad;
    expect(valid({ version: 1, thresholds: { trackPad: min } })).toBe(true);
    expect(valid({ version: 1, thresholds: { trackPad: max } })).toBe(true);
    expect(valid({ version: 1, thresholds: { trackPad: min - 1 } })).toBe(false);
    expect(valid({ version: 1, thresholds: { trackPad: max + 1 } })).toBe(false);
  });

  it('accepts a version from 1 and refuses 0, a negative, a fraction and a string', () => {
    expect(valid({ version: 1 })).toBe(true);
    expect(valid({ version: 2147483647 })).toBe(true);
    expect(valid({ version: 0 })).toBe(false);
    expect(valid({ version: -1 })).toBe(false);
    expect(valid({ version: 1.5 })).toBe(false);
    expect(valid({ version: '1' })).toBe(false);
    expect(valid({ version: 2147483648 })).toBe(false);
  });
});

describe('AgentConfig regions (RCF-05)', () => {
  const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };

  it('accepts a region inside the client, up to its edge', () => {
    expect(valid({ version: 1, regions: { hudBand: region } })).toBe(true);
    expect(valid({ version: 1, regions: { partyArea: { x: 0, y: 0, width: 1, height: 1 } } })).toBe(true);
    expect(valid({ version: 1, regions: { automapArea: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } } })).toBe(
      true,
    );
  });

  it('refuses a region that lies outside the client', () => {
    expect(valid({ version: 1, regions: { hudBand: { ...region, x: 0.6 } } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { ...region, y: 0.6 } } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { ...region, x: -0.1 } } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { ...region, width: 1.1 } } })).toBe(false);
  });

  it('refuses a region under the minimum size and accepts one at it', () => {
    const { min } = AGENT_CONFIG_RANGES.regionSize;
    expect(valid({ version: 1, regions: { hudBand: { ...region, width: min } } })).toBe(true);
    expect(valid({ version: 1, regions: { hudBand: { ...region, height: min } } })).toBe(true);
    expect(valid({ version: 1, regions: { hudBand: { ...region, width: min / 2 } } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { ...region, height: min / 2 } } })).toBe(false);
  });

  it('refuses an unknown region and a region with an extra key', () => {
    expect(valid({ version: 1, regions: { chat: region } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { ...region, depth: 1 } } })).toBe(false);
  });
});

describe('AgentConfig phrases (RCF-03, RCF-10)', () => {
  it('accepts literal words with letters, digits, spaces and the accents of en and pt-BR', () => {
    expect(valid({ version: 1, phrases: { en: { party: 'Party', gameName: 'Game Name 2' } } })).toBe(true);
    expect(
      valid({
        version: 1,
        phrases: { 'pt-BR': { party: 'Grupo', gameName: 'Nome do Jogo', password: 'Senha' } },
      }),
    ).toBe(true);
    expect(valid({ version: 1, phrases: { 'pt-BR': { password: 'Sess\u00e3o \u00c7' } } })).toBe(true);
  });

  it('refuses anything that looks like a pattern, a command, a path or a URL', () => {
    for (const phrase of [
      '.*',
      '[a-z]+',
      '(Party)',
      'Party|Grupo',
      'a\\d',
      'a?b',
      '^Party$',
      'rm -rf /',
      'C:\\x',
      'http://x.y',
      'a;b',
      'a\nb',
      'a\tb',
    ]) {
      expect(valid({ version: 1, phrases: { en: { party: phrase } } }), JSON.stringify(phrase)).toBe(false);
    }
  });

  it('refuses an empty phrase and one over 40 characters, and accepts one of exactly 40', () => {
    expect(valid({ version: 1, phrases: { en: { party: '' } } })).toBe(false);
    expect(valid({ version: 1, phrases: { en: { party: 'a'.repeat(40) } } })).toBe(true);
    expect(valid({ version: 1, phrases: { en: { party: 'a'.repeat(41) } } })).toBe(false);
  });

  it('accepts the chat phrases joinedGame and leftGame and refuses a hostile one', () => {
    expect(
      valid({ version: 1, phrases: { en: { joinedGame: 'joined the game', leftGame: 'left the game' } } }),
    ).toBe(true);
    expect(
      valid({ version: 1, phrases: { 'pt-BR': { joinedGame: 'entrou no jogo', leftGame: 'saiu do jogo' } } }),
    ).toBe(true);
    for (const phrase of ['', '.*', 'joined|left', 'a'.repeat(41), 'http://x.y', 'a\nb']) {
      expect(valid({ version: 1, phrases: { en: { joinedGame: phrase } } }), JSON.stringify(phrase)).toBe(
        false,
      );
      expect(valid({ version: 1, phrases: { en: { leftGame: phrase } } }), JSON.stringify(phrase)).toBe(
        false,
      );
    }
    expect(valid({ version: 1, phrases: { en: { joinedGame: 'a'.repeat(40) } } })).toBe(true);
  });

  it('refuses an unknown language and an unknown word', () => {
    expect(valid({ version: 1, phrases: { fr: { party: 'Groupe' } } })).toBe(false);
    expect(valid({ version: 1, phrases: { en: { hotkey: 'F5' } } })).toBe(false);
  });
});

describe('AgentConfig is a closed document (RCF-02)', () => {
  it('accepts the document with only a version: every section is optional', () => {
    expect(AgentConfig.parse({ version: 1 })).toStrictEqual({ version: 1 });
    expect(
      AgentConfig.parse({ version: 3, cadence: {}, thresholds: {}, regions: {}, phrases: {} }),
    ).toStrictEqual({
      version: 3,
      cadence: {},
      thresholds: {},
      regions: {},
      phrases: {},
    });
  });

  it('refuses a document without a version', () => {
    expect(valid({})).toBe(false);
    expect(valid({ cadence: { probeEvery: 60 } })).toBe(false);
  });

  it('refuses a field outside the schema at every level', () => {
    expect(valid({ version: 1, apiBase: 'https://x.y' })).toBe(false);
    expect(valid({ version: 1, cadence: { heartbeatSeconds: 5 } })).toBe(false);
    expect(valid({ version: 1, thresholds: { command: 'x' } })).toBe(false);
    expect(valid({ version: 1, regions: { hudBand: { x: 0, y: 0, width: 1, height: 1, url: 'x' } } })).toBe(
      false,
    );
    expect(valid({ version: 1, phrases: { en: { party: 'Party', script: 'x' } } })).toBe(false);
  });

  it('serves the same type as the response and bounds the body at 64 KiB', () => {
    expect(AgentConfigResponse).toBe(AgentConfig);
    expect(AGENT_CONFIG_MAX_BYTES).toBe(65536);
  });
});
