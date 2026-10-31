import type { AnyDomainEvent, BusEvent, EventBus } from '../../../../shared-kernel/index.ts';

/** EventBus that keeps what was published, in order, and calls subscribers like the platform bus. */
export class RecordingEventBus implements EventBus {
  readonly published: BusEvent[] = [];
  readonly #handlers = new Map<AnyDomainEvent['type'], Array<(event: BusEvent) => Promise<void> | void>>();

  async publish(event: BusEvent): Promise<void> {
    this.published.push(event);
    for (const handler of this.#handlers.get(event.event.type) ?? []) {
      await handler(event);
    }
  }

  subscribe(type: AnyDomainEvent['type'], handler: (event: BusEvent) => Promise<void> | void): void {
    this.#handlers.set(type, [...(this.#handlers.get(type) ?? []), handler]);
  }
}
