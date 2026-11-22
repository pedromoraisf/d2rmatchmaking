import { describe, expect, it } from 'vitest';
import {
  D2R_ACCOUNT_BATTLETAG,
  D2R_ACCOUNT_ID,
  D2R_AGENT_ID,
  D2R_AGENT_VERSION,
  D2R_CHARACTER_NAME,
  D2R_GAME_NAME,
  D2R_OBSERVATION_READ_NAMES,
  D2R_OBSERVATION_READ_TEXT,
  D2R_READY_CHECK_ID,
  D2R_RUN_ID,
  D2R_TICKET_ID,
  D2R_DIFFICULTY,
  D2R_ERA,
  D2R_LADDER,
  D2R_OUTBOX_EVENT_TYPE,
  D2R_QUEUE_MODE,
  D2R_ROOM_ACTIVITY,
  D2R_ROOM_ID,
  D2R_ROOM_RUN,
  D2R_ROOM_STAGE,
  D2R_STREAM_KIND,
} from './attributes.ts';
import { STAGING_ONLY_KEYS } from './redact-attributes.ts';

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
      roomRun: D2R_ROOM_RUN,
      roomActivity: D2R_ROOM_ACTIVITY,
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
      roomRun: 'd2r.room.run',
      roomActivity: 'd2r.room.activity',
    });
  });
});

describe('journey ids and full-tier attributes (OBT-03, OBT-04)', () => {
  it('names the ids and the game name', () => {
    expect([
      D2R_ACCOUNT_ID,
      D2R_AGENT_ID,
      D2R_RUN_ID,
      D2R_TICKET_ID,
      D2R_READY_CHECK_ID,
      D2R_GAME_NAME,
    ]).toStrictEqual([
      'd2r.account.id',
      'd2r.agent.id',
      'd2r.run.id',
      'd2r.ticket.id',
      'd2r.ready_check.id',
      'd2r.game.name',
    ]);
  });

  it('names the keys only the full tier carries, the same ones the redaction drops in production', () => {
    expect(
      [
        D2R_ACCOUNT_BATTLETAG,
        D2R_CHARACTER_NAME,
        D2R_OBSERVATION_READ_TEXT,
        D2R_OBSERVATION_READ_NAMES,
      ].sort(),
    ).toStrictEqual([...STAGING_ONLY_KEYS].filter((key) => !key.startsWith('d2r.ocr.')).sort());
  });
});
