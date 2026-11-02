import type { Histogram, Meter } from '@opentelemetry/api';
import { D2R_DIFFICULTY, D2R_QUEUE_MODE, D2R_ROOM_STAGE, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import type { RoomStage } from '../../../../shared-kernel/index.ts';
import type { GameDifficulty } from '../../domain/game-name.ts';
import type { RoomMetrics } from '../../application/ports.ts';

/**
 * The OpenTelemetry adapter of `RoomMetrics`: one histogram, `room.stage_duration`, on the application meter. Its
 * attributes are the bounded set (stage, difficulty, queue mode); no room, account or agent id reaches it.
 */
export class OtelRoomMetrics implements RoomMetrics {
  readonly #stageDuration: Histogram;

  constructor(meter: Meter) {
    this.#stageDuration = meter.createHistogram(INSTRUMENT_NAMES.roomStageDuration, {
      unit: 's',
      description: 'Seconds a lobby room spent in a stage before it left it.',
    });
  }

  stageLeft(stage: RoomStage, difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.#stageDuration.record(seconds, {
      [D2R_ROOM_STAGE]: stage,
      [D2R_DIFFICULTY]: difficulty,
      [D2R_QUEUE_MODE]: mode,
    });
  }
}
