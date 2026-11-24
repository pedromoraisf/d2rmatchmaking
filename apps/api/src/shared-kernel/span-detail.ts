// The port through which a use case sets the attributes only the full telemetry tier carries (ADR 037, OBT-04): a
// player's BattleTag, a character name, text and names read on screen. The composition root gives the full tier the
// implementation that annotates the active span and every other tier the one that does nothing, so a production process
// never builds these values into a span. The exporter redacts the same keys again (defence in depth, OBT-08).
import { annotateActiveSpan, type SpanAttributes } from './tracing.ts';

export interface SpanDetail {
  /** Sets full-tier attributes on the active span. Does nothing in the production tier. */
  annotate(attributes: SpanAttributes): void;
}

/** The production tier: nothing is recorded. */
export const NO_SPAN_DETAIL: SpanDetail = {
  annotate: () => undefined,
};

/** The full tier: the attributes go on the active span. */
export const ACTIVE_SPAN_DETAIL: SpanDetail = {
  annotate: (attributes) => {
    annotateActiveSpan(attributes);
  },
};
