/** A paired desktop agent. Its token hash is present once a token was claimed; `revokedAt` deactivates it. */
export class Agent {
  readonly id: string;
  readonly accountId: string | undefined;
  readonly tokenHash: string | undefined;
  readonly claimSecretHash: string;
  readonly tokenClaimedAt: Date | undefined;
  readonly pairedAt: Date | undefined;
  readonly revokedAt: Date | undefined;

  constructor(props: {
    readonly id: string;
    readonly claimSecretHash: string;
    readonly accountId?: string | undefined;
    readonly tokenHash?: string | undefined;
    readonly tokenClaimedAt?: Date | undefined;
    readonly pairedAt?: Date | undefined;
    readonly revokedAt?: Date | undefined;
  }) {
    this.id = props.id;
    this.claimSecretHash = props.claimSecretHash;
    this.accountId = props.accountId;
    this.tokenHash = props.tokenHash;
    this.tokenClaimedAt =
      props.tokenClaimedAt === undefined ? undefined : new Date(props.tokenClaimedAt.getTime());
    this.pairedAt = props.pairedAt === undefined ? undefined : new Date(props.pairedAt.getTime());
    this.revokedAt = props.revokedAt === undefined ? undefined : new Date(props.revokedAt.getTime());
  }

  /** Binds the agent to an account (AD-037: the previous agent of that account is revoked by the use case). */
  pair(accountId: string, now: Date): Agent {
    return new Agent({ ...this.#props(), accountId, pairedAt: now });
  }

  revoke(now: Date): Agent {
    return new Agent({ ...this.#props(), revokedAt: now });
  }

  /** True when a token was claimed and the agent is not revoked. */
  isActive(): boolean {
    return this.tokenHash !== undefined && this.revokedAt === undefined;
  }

  #props() {
    return {
      id: this.id,
      claimSecretHash: this.claimSecretHash,
      accountId: this.accountId,
      tokenHash: this.tokenHash,
      tokenClaimedAt: this.tokenClaimedAt,
      pairedAt: this.pairedAt,
      revokedAt: this.revokedAt,
    };
  }
}
