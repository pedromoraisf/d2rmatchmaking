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
  readonly finals: {
    readonly stage: 'closed' | 'expired';
    readonly difficulty: GameDifficulty;
    readonly mode: 'pvp' | 'leveling';
  }[] = [];
  readonly actives: {
    readonly difficulty: GameDifficulty;
    readonly mode: 'pvp' | 'leveling';
    readonly seconds: number;
  }[] = [];

  finalStage(stage: 'closed' | 'expired', difficulty: GameDifficulty, mode: 'pvp' | 'leveling'): void {
    this.finals.push({ stage, difficulty, mode });
  }

  timeToActive(difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.actives.push({ difficulty, mode, seconds });
  }

  stageLeft(stage: RoomStage, difficulty: GameDifficulty, mode: 'pvp' | 'leveling', seconds: number): void {
    this.calls.push({ stage, difficulty, mode, seconds });
  }
}
