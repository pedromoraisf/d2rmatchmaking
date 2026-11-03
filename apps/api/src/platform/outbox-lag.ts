// The outbox lag gauge (OBS-33): `outbox.lag`, the age in seconds of the oldest row the relay has neither published nor
// dead-lettered. The SDK awaits the callback at each collection (once per metric export, 60 s by default), so the query
// adds no wake-up of its own. The age comes from the injected Clock (AD-087).
import type { Meter } from '@opentelemetry/api';
import type { Kysely } from 'kysely';
import { INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import type { Clock } from '../shared-kernel/index.ts';
import type { PlatformDatabase } from './postgres/database.ts';

/** Registers the gauge on `meter`. Called once, by `buildApp`. Zero when no row is waiting. */
export function registerOutboxLag(meter: Meter, db: Kysely<PlatformDatabase>, clock: Clock): void {
  meter
    .createObservableGauge(INSTRUMENT_NAMES.outboxLag, {
      unit: 's',
      description: 'Age of the oldest outbox row the relay has not published yet.',
    })
    .addCallback(async (result) => {
      const oldest = await db
        .selectFrom('platform.outbox')
        .select('created_at')
        .where('published_at', 'is', null)
        .where('failed_at', 'is', null)
        .orderBy('id')
        .limit(1)
        .executeTakeFirst();
      result.observe(oldest === undefined ? 0 : (clock.now().getTime() - oldest.created_at.getTime()) / 1000);
    });
}
