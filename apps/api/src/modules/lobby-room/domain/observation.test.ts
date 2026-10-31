import { describe, expect, it } from 'vitest';
import { Observation, isObservationType, type ObservationProps } from './observation.ts';

const base: ObservationProps = {
  agentId: 'agent-1',
  idempotencyKey: 'key-1',
  roomId: 'room-1',
  accountId: 'account-1',
  type: 'GAME_NAME_SEEN',
  run: 1,
  value: 'mmbaalh-12',
  confidence: 0.9,
  capturedAt: new Date('2026-10-31T10:00:00.000Z'),
};

describe('Observation', () => {
  it('accepts a value of exactly 64 characters and confidence 0 and 1', () => {
    expect(Observation.of({ ...base, value: 'x'.repeat(64), confidence: 0 }).ok).toBe(true);
    expect(Observation.of({ ...base, value: 'x'.repeat(64), confidence: 1 }).ok).toBe(true);
  });

  it('rejects a value of 65 characters', () => {
    expect(Observation.of({ ...base, value: 'x'.repeat(65) })).toEqual({
      ok: false,
      error: 'invalid-observation',
    });
  });

  it('rejects a confidence above 1', () => {
    expect(Observation.of({ ...base, confidence: 1.1 })).toEqual({ ok: false, error: 'invalid-observation' });
  });

  it('rejects a confidence below 0', () => {
    expect(Observation.of({ ...base, confidence: -0.1 })).toEqual({
      ok: false,
      error: 'invalid-observation',
    });
  });

  it('recognises the six glossary types only', () => {
    expect(isObservationType('ROUND_REPORTED')).toBe(true);
    expect(isObservationType('UNKNOWN')).toBe(false);
    expect(isObservationType('SOMETHING_NEW')).toBe(false);
  });
});
