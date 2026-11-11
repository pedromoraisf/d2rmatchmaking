import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';
import {
  connectivityLabel,
  offersNewCode,
  pairingLabel,
  revealLabel,
  roomLabel,
  updateLabel,
  type Label,
} from './labels.ts';

const room = (overrides: { needsReveal?: boolean; matched?: boolean } = {}) => ({
  gameName: 'mmbaalh-12',
  needsReveal: false,
  matched: false,
  ...overrides,
});

// Every key path of a translation file, with nested objects flattened to dotted paths.
const keyPaths = (node: unknown, prefix = ''): string[] => {
  if (typeof node !== 'object' || node === null) {
    return [prefix];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
};

describe('agent labels', () => {
  it('maps every pairing state the core publishes to a translation key', () => {
    expect(pairingLabel('requesting')).toStrictEqual({ key: 'pairing.requesting' });
    expect(pairingLabel('paused')).toStrictEqual({ key: 'pairing.paused' });
    expect(pairingLabel('rateLimited')).toStrictEqual({ key: 'pairing.rateLimited' });
    expect(pairingLabel('unreachable')).toStrictEqual({ key: 'connectivity.unreachable' });
    expect(pairingLabel('saveFailed')).toStrictEqual({ key: 'pairing.saveFailed' });
    expect(pairingLabel('paired')).toStrictEqual({ key: 'pairing.paired' });
  });

  it('shows no text line for a code, which the pairing view draws itself', () => {
    expect(pairingLabel({ showingCode: { code: '123456', minutesLeft: 5 } })).toBeNull();
  });

  it('offers a new code only while paused', () => {
    expect(offersNewCode('paused')).toBe(true);
    expect(offersNewCode('rateLimited')).toBe(false);
    expect(offersNewCode('paired')).toBe(false);
    expect(offersNewCode({ showingCode: { code: '123456', minutesLeft: 5 } })).toBe(false);
  });

  it('names the connection, room and update lines with their values', () => {
    expect(connectivityLabel('connected')).toStrictEqual({ key: 'connectivity.connected' });
    expect(roomLabel(room())).toStrictEqual({
      key: 'room.waiting',
      values: { gameName: 'mmbaalh-12' },
    });
    expect(roomLabel(null)).toBeNull();
    expect(updateLabel('idle')).toBeNull();
    expect(updateLabel('failed')).toStrictEqual({ key: 'update.failed' });
    expect(updateLabel('required')).toStrictEqual({ key: 'update.required' });
  });

  it('shows the reveal hint only while the masked name is unmatched (AGN-04)', () => {
    expect(revealLabel(null)).toBeNull();
    expect(revealLabel(room())).toBeNull();
    expect(revealLabel(room({ needsReveal: true }))).toStrictEqual({ key: 'room.revealHint' });
    expect(revealLabel(room({ needsReveal: true, matched: true }))).toBeNull();
  });

  it('uses only keys both translation files define', () => {
    const labels: (Label | null)[] = [
      pairingLabel('requesting'),
      pairingLabel('paused'),
      pairingLabel('rateLimited'),
      pairingLabel('unreachable'),
      pairingLabel('saveFailed'),
      pairingLabel('paired'),
      connectivityLabel('connected'),
      connectivityLabel('unreachable'),
      roomLabel(room()),
      revealLabel(room({ needsReveal: true })),
      updateLabel('failed'),
      updateLabel('required'),
    ];
    for (const label of labels) {
      expect(keyPaths(en)).toContain(label?.key);
      expect(keyPaths(ptBR)).toContain(label?.key);
    }
  });
});
