const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** A browser session. It is valid strictly before `expiresAt` (7 days after it was opened). */
export class Session {
  readonly accountId: string;
  readonly expiresAt: Date;

  constructor(accountId: string, expiresAt: Date) {
    this.accountId = accountId;
    this.expiresAt = new Date(expiresAt.getTime());
  }

  static open(accountId: string, now: Date): Session {
    return new Session(accountId, new Date(now.getTime() + SESSION_LIFETIME_MS));
  }

  isValidAt(now: Date): boolean {
    return now.getTime() < this.expiresAt.getTime();
  }
}
