import type { AnyDomainEvent, BusEvent, EventBus } from '../shared-kernel/index.ts';

type Handler = (event: BusEvent) => Promise<void> | void;

/**
 * In-process EventBus (ADR 006: no broker in the MVP). Subscribers run one after another in subscription order and
 * `publish` resolves only when every subscriber has finished. A throwing subscriber rejects `publish`.
 */
export class InMemoryEventBus implements EventBus {
  readonly #handlers = new Map<AnyDomainEvent['type'], Handler[]>();

  subscribe(type: AnyDomainEvent['type'], handler: Handler): void {
    const handlers = this.#handlers.get(type) ?? [];
    handlers.push(handler);
    this.#handlers.set(type, handlers);
  }

  async publish(event: BusEvent): Promise<void> {
    const handlers = this.#handlers.get(event.event.type) ?? [];
    for (const handler of [...handlers]) {
      await handler(event);
    }
  }
}
