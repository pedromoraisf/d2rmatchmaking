import { describe, expect, it } from 'vitest';
import { INSTRUMENT_NAMES } from './instrument-names.ts';

describe('metric instrument names', () => {
  it('lists the five skeleton instruments', () => {
    expect(Object.values(INSTRUMENT_NAMES).sort()).toStrictEqual(
      [
        'http.server.request.duration',
        'http.server.response.body.size',
        'sse.connections',
        'outbox.lag',
        'room.stage_duration',
      ].sort(),
    );
  });
});
