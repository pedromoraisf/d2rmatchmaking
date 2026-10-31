import type { PresenceEntry, PresenceStore } from '../../application/ports.ts';

/** In-memory presence by agent id (ADR 006): heartbeats never reach the database (AWS-33). */
export class MemoryPresenceStore implements PresenceStore {
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
