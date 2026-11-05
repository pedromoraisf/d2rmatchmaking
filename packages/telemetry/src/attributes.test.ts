import { describe, expect, it } from 'vitest';
import {
  D2R_AGENT_VERSION,
  D2R_DIFFICULTY,
  D2R_ERA,
  D2R_LADDER,
  D2R_OUTBOX_EVENT_TYPE,
  D2R_QUEUE_MODE,
  D2R_ROOM_ID,
  D2R_ROOM_STAGE,
  D2R_STREAM_KIND,
} from './attributes.ts';

describe('standardized d2r attributes', () => {
  it('exports the standardized d2r attribute constants', () => {
    expect({
      roomId: D2R_ROOM_ID,
      queueMode: D2R_QUEUE_MODE,
      difficulty: D2R_DIFFICULTY,
      ladder: D2R_LADDER,
      era: D2R_ERA,
      agentVersion: D2R_AGENT_VERSION,
      streamKind: D2R_STREAM_KIND,
      roomStage: D2R_ROOM_STAGE,
      outboxEventType: D2R_OUTBOX_EVENT_TYPE,
    }).toStrictEqual({
      roomId: 'd2r.room.id',
      queueMode: 'd2r.queue.mode',
      difficulty: 'd2r.difficulty',
      ladder: 'd2r.ladder',
      era: 'd2r.era',
      agentVersion: 'd2r.agent.version',
      streamKind: 'd2r.stream.kind',
      roomStage: 'd2r.room.stage',
      outboxEventType: 'd2r.outbox.event_type',
    });
  });
});
