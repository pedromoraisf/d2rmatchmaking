import { describe, expect, it } from 'vitest';
import { readyCheckRefusalStatus } from './ready-check-routes.ts';

describe('readyCheckRefusalStatus (RDY-06)', () => {
  it('answers 404 for a player who is not in the check', () => {
    expect(readyCheckRefusalStatus('not-found')).toBe(404);
  });

  it('answers 409 for a check that ended', () => {
    expect(readyCheckRefusalStatus('ready-check-ended')).toBe(409);
  });

  it('answers 409 for an answer already given', () => {
    expect(readyCheckRefusalStatus('already-answered')).toBe(409);
  });
});
