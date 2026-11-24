// Which `SpanDetail` a process uses, from its telemetry tier (ADR 037, OBT-04). Only the composition root calls this.
import type { TelemetryTier } from '@d2rmm/telemetry';
import { ACTIVE_SPAN_DETAIL, NO_SPAN_DETAIL, type SpanDetail } from '../shared-kernel/index.ts';

/** The full tier records names and read text on spans; any other tier records none. */
export function spanDetailFor(tier: TelemetryTier | undefined): SpanDetail {
  return tier === 'full' ? ACTIVE_SPAN_DETAIL : NO_SPAN_DETAIL;
}
