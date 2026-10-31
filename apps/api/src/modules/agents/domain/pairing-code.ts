import { err, ok, type RandomSource, type Result } from '../../../shared-kernel/index.ts';

const PAIRING_CODE_LIFETIME_MS = 5 * 60 * 1000;

export type ClaimState = 'pending' | 'claimable' | 'gone';

/** A 6-digit code that pairs an agent with an account. Single use, valid for 5 minutes (AD-032, design.md § Agents). */
export class PairingCode {
  readonly agentId: string;
  readonly code: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | undefined;
  readonly accountId: string | undefined;

  constructor(props: {
    readonly agentId: string;
    readonly code: string;
    readonly expiresAt: Date;
    readonly usedAt?: Date;
    readonly accountId?: string;
  }) {
    this.agentId = props.agentId;
    this.code = props.code;
    this.expiresAt = new Date(props.expiresAt.getTime());
    this.usedAt = props.usedAt === undefined ? undefined : new Date(props.usedAt.getTime());
    this.accountId = props.accountId;
  }

  /** Six digits, zero-padded, expiring 5 minutes after `now`. */
  static issue(agentId: string, random: RandomSource, now: Date): PairingCode {
    const code = String(random.int(1_000_000)).padStart(6, '0');
    return new PairingCode({ agentId, code, expiresAt: new Date(now.getTime() + PAIRING_CODE_LIFETIME_MS) });
  }

  /** Binds the code to an account. Only an unused code that has not expired (strictly before `expiresAt`) is accepted. */
  use(accountId: string, now: Date): Result<PairingCode, 'invalid-code'> {
    if (this.usedAt !== undefined || now.getTime() >= this.expiresAt.getTime()) {
      return err('invalid-code');
    }
    return ok(
      new PairingCode({
        agentId: this.agentId,
        code: this.code,
        expiresAt: this.expiresAt,
        usedAt: now,
        accountId,
      }),
    );
  }

  /** `pending` while unused and unexpired, `claimable` once used, `gone` when it expired unused. */
  claimState(now: Date): ClaimState {
    if (this.usedAt !== undefined) {
      return 'claimable';
    }
    return now.getTime() < this.expiresAt.getTime() ? 'pending' : 'gone';
  }
}
