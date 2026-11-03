import type { RoomStage } from '../../../../shared-kernel/index.ts';
import type { RoomMetrics } from '../ports.ts';
import type { GameDifficulty } from '../../domain/game-name.ts';

export interface StageLeftCall {
  readonly stage: RoomStage;
  readonly difficulty: GameDifficulty;
  readonly mode: 'pvp' | 'leveling';
  readonly seconds: number;
}

/** RoomMetrics that keeps every call, in order. */
export class FakeRoomMetrics implements RoomMetrics {
  readonly calls: StageLeftCall[] = [];

  stageLeft(stage: RoomStage, difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.calls.push({ stage, difficulty, mode, seconds });
  }
}
