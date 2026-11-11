import type { MemberConnectivity } from '../ports.ts';

/** MemberConnectivity a test drives: it sets the instants an agent went offline and a site stream closed. */
export class FakeMemberConnectivity implements MemberConnectivity {
  readonly #agentOffline = new Map<string, Date>();
  readonly #siteClosed = new Map<string, Date>();

  setAgentOffline(accountId: string, since: Date | null): void {
    if (since === null) {
      this.#agentOffline.delete(accountId);
    } else {
      this.#agentOffline.set(accountId, since);
    }
  }

  setSiteClosed(accountId: string, since: Date | null): void {
    if (since === null) {
      this.#siteClosed.delete(accountId);
    } else {
      this.#siteClosed.set(accountId, since);
    }
  }

  async agentOfflineSince(accountId: string): Promise<Date | null> {
    return this.#agentOffline.get(accountId) ?? null;
  }

  siteStreamClosedSince(accountId: string): Date | null {
    return this.#siteClosed.get(accountId) ?? null;
  }
}
