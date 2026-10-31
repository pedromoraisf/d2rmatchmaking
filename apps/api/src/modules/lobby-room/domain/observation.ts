import { err, ok, type Result } from '../../../shared-kernel/result.ts';

/** The six observation types of the glossary. Anything else is `UNKNOWN` and is never stored (AWS-25). */
export const OBSERVATION_TYPES = [
  'GAME_NAME_SEEN',
  'PLAYER_JOINED_SEEN',
  'PLAYER_LEFT_SEEN',
  'SCREEN_CHANGED',
  'ROUND_REPORTED',
  'PLAYER_SLAIN_SEEN',
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];

const MAX_VALUE_LENGTH = 64;

export function isObservationType(raw: string): raw is ObservationType {
  return (OBSERVATION_TYPES as readonly string[]).includes(raw);
}

export interface ObservationProps {
  readonly agentId: string;
  readonly idempotencyKey: string;
  readonly roomId: string;
  readonly accountId: string;
  readonly type: ObservationType;
  readonly run: number;
  readonly value: string;
  readonly confidence: number;
  readonly capturedAt: Date;
}

/** A fact an agent read from the game window (design.md § Lobby Room module). */
export class Observation {
  readonly agentId: string;
  readonly idempotencyKey: string;
  readonly roomId: string;
  readonly accountId: string;
  readonly type: ObservationType;
  readonly run: number;
  readonly value: string;
  readonly confidence: number;
  readonly capturedAt: Date;

  private constructor(props: ObservationProps) {
    this.agentId = props.agentId;
    this.idempotencyKey = props.idempotencyKey;
    this.roomId = props.roomId;
    this.accountId = props.accountId;
    this.type = props.type;
    this.run = props.run;
    this.value = props.value;
    this.confidence = props.confidence;
    this.capturedAt = new Date(props.capturedAt.getTime());
  }

  /** Accepts a value of at most 64 characters and a confidence from 0 to 1 inclusive. */
  static of(props: ObservationProps): Result<Observation, 'invalid-observation'> {
    if (props.value.length > MAX_VALUE_LENGTH) {
      return err('invalid-observation');
    }
    if (!(props.confidence >= 0 && props.confidence <= 1)) {
      return err('invalid-observation');
    }
    return ok(new Observation(props));
  }
}
