import type { PresenceEntry, PresenceStore } from '../ports.ts';

/** In-memory PresenceStore keyed by agent id. */
export class InMemoryPresenceStore implements PresenceStore {
  readonly #entries = new Map<string, PresenceEntry>();

  get(agentId: string): PresenceEntry | undefined {
    return this.#entries.get(agentId);
  }

  set(entry: PresenceEntry): void {
    this.#entries.set(entry.agentId, entry);
  }

  list(): PresenceEntry[] {
    return [...this.#entries.values()];
  }
}
