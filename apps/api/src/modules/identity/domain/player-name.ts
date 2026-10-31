import { err, ok, type Result } from '../../../shared-kernel/result.ts';

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9-]{2,16}$/;

/** A test account's display name (AD-042). The value is kept as typed; the test key is its lower-cased form. */
export interface PlayerName {
  readonly value: string;
  readonly testKey: string;
}

export const PlayerName = {
  /** Accepts 2 to 16 characters of letters, digits and `-`. Never trims: a space is a rejected character. */
  parse(raw: string): Result<PlayerName, 'invalid-name'> {
    if (!PLAYER_NAME_PATTERN.test(raw)) {
      return err('invalid-name');
    }
    return ok({ value: raw, testKey: raw.toLowerCase() });
  },
};
