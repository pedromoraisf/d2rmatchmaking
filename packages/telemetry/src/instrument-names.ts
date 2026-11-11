// The meter of the application's own instruments (request metrics and room metrics). The root entry carries it, so the
// composition root and the adapters name the meter without the SDK (the views read the same constant).
export const APP_METER_NAME = 'd2rmm';

// The five metric instruments of AD-087, the queue's two (F1, queues QUE-16) and the ready check's outcome counter (F1,
// RDY-10). Creators use these names; the dashboard test compares its queries with them (OBS-36).
export const INSTRUMENT_NAMES = {
  httpServerRequestDuration: 'http.server.request.duration',
  httpServerResponseBodySize: 'http.server.response.body.size',
  sseConnections: 'sse.connections',
  outboxLag: 'outbox.lag',
  roomStageDuration: 'room.stage_duration',
  queueSize: 'd2r.queue.size',
  queueWait: 'd2r.queue.wait',
  readyCheckResolved: 'd2r.ready_check.resolved',
} as const;
