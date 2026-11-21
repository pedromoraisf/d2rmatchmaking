import { PlayerNameValue } from '@d2rmm/contracts';
import { describe, expect, it } from 'vitest';
import { isPlayerNameReading, isPlayerSighting } from './player-sighting.ts';

const SAMPLES = [
  'Sorc',
  'S0rc',
  'Il',
  'Hammer_Smith',
  'Ab',
  'ThisNameIsFifte',
  'a-b',
  'S',
  '',
  'Sorc Sorc',
  'Sorc2',
  '0Sorc',
  'Sorc1x_',
  '_Sorc',
  'Sor-c-c',
  'Sor__c',
  'ThisNameIsTooLongXX',
  'Sörc',
  'Sorc-',
  'S-0c',
  'Ab1',
];

describe('the reading rule of a chat name', () => {
  it.each(SAMPLES)('agrees with the contract on %j', (value) => {
    expect(isPlayerNameReading(value)).toBe(PlayerNameValue.safeParse(value).success);
  });

  it('knows the two sighting types', () => {
    expect(isPlayerSighting('PLAYER_JOINED_SEEN')).toBe(true);
    expect(isPlayerSighting('PLAYER_LEFT_SEEN')).toBe(true);
    expect(isPlayerSighting('GAME_NAME_SEEN')).toBe(false);
  });
});
