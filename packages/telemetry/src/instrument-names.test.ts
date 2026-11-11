import { describe, expect, it } from 'vitest';
import { INSTRUMENT_NAMES } from './instrument-names.ts';

describe('metric instrument names', () => {
  it('lists the five skeleton instruments, the two queue instruments and the ready check counter', () => {
    expect(Object.values(INSTRUMENT_NAMES).sort()).toStrictEqual(
      [
        'http.server.request.duration',
        'http.server.response.body.size',
        'sse.connections',
        'outbox.lag',
        'room.stage_duration',
        'd2r.queue.size',
        'd2r.queue.wait',
        'd2r.ready_check.resolved',
      ].sort(),
    );
  });
});
