import type { ServedAgentConfig } from '../../domain/agent-config.ts';
import type { AgentConfigSource } from '../../application/ports.ts';

/**
 * The served configuration, held in memory (ADR 006): the committed document read at start. The staging test control
 * replaces it with a raw body or with none, so a scenario can send what no committed file may hold (RCF-05, RCF-06).
 */
export class MemoryAgentConfigSource implements AgentConfigSource {
  readonly #initial: ServedAgentConfig | undefined;
  #current: ServedAgentConfig | undefined;

  constructor(initial: ServedAgentConfig | undefined) {
    this.#initial = initial;
    this.#current = initial;
  }

  current(): ServedAgentConfig | undefined {
    return this.#current;
  }

  /** Serves this document from now on, or none (the test controls only). */
  replace(served: ServedAgentConfig | undefined): void {
    this.#current = served;
  }

  /** Back to the committed document (the test controls' reset). */
  reset(): void {
    this.#current = this.#initial;
  }
}
