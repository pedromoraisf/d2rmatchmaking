import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { D2R_DIFFICULTY, D2R_QUEUE_MODE, D2R_ROOM_STAGE, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import type { RoomStage } from '../../../../shared-kernel/index.ts';
import type { GameDifficulty } from '../../domain/game-name.ts';
import type { RoomMetrics } from '../../application/ports.ts';

/**
 * The OpenTelemetry adapter of `RoomMetrics` on the application meter: `room.stage_duration` (histogram),
 * `d2r.room.final_stage` (counter) and `d2r.room.time_to_active` (histogram). Their attributes are the bounded set
 * (stage, difficulty, queue mode); no room, account or agent id reaches them.
 */
export class OtelRoomMetrics implements RoomMetrics {
  readonly #stageDuration: Histogram;
  readonly #finalStage: Counter;
  readonly #timeToActive: Histogram;

  constructor(meter: Meter) {
    this.#stageDuration = meter.createHistogram(INSTRUMENT_NAMES.roomStageDuration, {
      unit: 's',
      description: 'Seconds a lobby room spent in a stage before it left it.',
    });
    this.#finalStage = meter.createCounter(INSTRUMENT_NAMES.roomFinalStage, {
      description: 'Lobby rooms that ended, by the stage they ended in (closed or expired).',
    });
    this.#timeToActive = meter.createHistogram(INSTRUMENT_NAMES.roomTimeToActive, {
      unit: 's',
      description: 'Seconds from a lobby room opening to its first active stage.',
    });
  }

  finalStage(stage: 'closed' | 'expired', difficulty: GameDifficulty, mode: 'pvp' | 'leveling'): void {
    this.#finalStage.add(1, {
      [D2R_ROOM_STAGE]: stage,
      [D2R_DIFFICULTY]: difficulty,
      [D2R_QUEUE_MODE]: mode,
    });
  }

  timeToActive(difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.#timeToActive.record(seconds, { [D2R_DIFFICULTY]: difficulty, [D2R_QUEUE_MODE]: mode });
  }

  stageLeft(stage: RoomStage, difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.#stageDuration.record(seconds, {
      [D2R_ROOM_STAGE]: stage,
      [D2R_DIFFICULTY]: difficulty,
      [D2R_QUEUE_MODE]: mode,
    });
  }
}
