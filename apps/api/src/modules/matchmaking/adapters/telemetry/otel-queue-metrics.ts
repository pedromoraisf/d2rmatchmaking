// The queue's metrics on the application meter (QUE-16): the waiting size as an observable gauge, the wait at match as a
// histogram. Only the bounded attributes of QUE-16 are recorded: no account and no character name.
import { D2R_DIFFICULTY, D2R_ERA, D2R_LADDER, D2R_QUEUE_MODE } from '@d2rmm/telemetry';
import type { Meter } from '@opentelemetry/api';
import type { QueueAttributes, QueueMetrics } from '../../application/ports.ts';

/** `d2r.queue.size`: the tickets waiting in one pool (gauge). */
export const QUEUE_SIZE_METRIC = 'd2r.queue.size';
/** `d2r.queue.wait`: the seconds a ticket waited when it left in a match (histogram). */
export const QUEUE_WAIT_METRIC = 'd2r.queue.wait';

function attributesOfPool(attributes: QueueAttributes): Record<string, string> {
  return {
    [D2R_QUEUE_MODE]: attributes.mode,
    [D2R_DIFFICULTY]: attributes.difficulty,
    [D2R_LADDER]: attributes.ladder,
    [D2R_ERA]: attributes.era,
  };
}

export class OtelQueueMetrics implements QueueMetrics {
  /** The last size reported for each pool; the gauge reads these when the SDK collects. */
  readonly #sizes = new Map<string, { readonly attributes: QueueAttributes; size: number }>();
  readonly #wait;

  constructor(meter: Meter) {
    meter
      .createObservableGauge(QUEUE_SIZE_METRIC, {
        description: 'Tickets waiting in the queue, by pool.',
        unit: '{ticket}',
      })
      .addCallback((result) => {
        for (const { attributes, size } of this.#sizes.values()) {
          result.observe(size, attributesOfPool(attributes));
        }
      });
    this.#wait = meter.createHistogram(QUEUE_WAIT_METRIC, {
      description: 'Seconds a ticket waited before it left the queue in a match.',
      unit: 's',
    });
  }

  queueSize(attributes: QueueAttributes, size: number): void {
    this.#sizes.set([attributes.mode, attributes.difficulty, attributes.ladder, attributes.era].join('|'), {
      attributes,
      size,
    });
  }

  waitAtMatch(attributes: QueueAttributes, seconds: number): void {
    this.#wait.record(seconds, attributesOfPool(attributes));
  }
}
