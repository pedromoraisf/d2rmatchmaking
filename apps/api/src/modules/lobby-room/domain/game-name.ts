import { err, ok, type Result } from '../../../shared-kernel/result.ts';

export type GameDifficulty = 'normal' | 'nightmare' | 'hell';

/** Difficulty code inside a game name. F0 supports hell only (FR-14 arrives with F1). */
function difficultyCode(difficulty: GameDifficulty): string | undefined {
  switch (difficulty) {
    case 'hell':
      return 'h';
    default:
      return undefined;
  }
}

/**
 * The game name a host must create in the game and the agent must read back: `mm{activity}{difficulty}-{n}`
 * (INV-08, ADR 017). The password of a room is always empty.
 */
export class GameName {
  readonly value: string;
  readonly number: number;

  private constructor(value: string, number: number) {
    this.value = value;
    this.number = number;
  }

  static of(
    activity: string,
    difficulty: GameDifficulty,
    n: number,
  ): Result<GameName, 'unsupported-difficulty'> {
    const code = difficultyCode(difficulty);
    if (code === undefined) {
      return err('unsupported-difficulty');
    }
    return ok(new GameName(`mm${activity}${code}-${n}`, n));
  }

  /** Case-insensitive equality. Never trims: a leading space is a different name (AD-034). */
  matches(value: string): boolean {
    return value.toLowerCase() === this.value.toLowerCase();
  }
}
