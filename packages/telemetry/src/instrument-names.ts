// The five metric instruments of AD-087. Creators use these names; the dashboard test compares its queries with them (OBS-36).
export const INSTRUMENT_NAMES = {
  httpServerRequestDuration: 'http.server.request.duration',
  httpServerResponseBodySize: 'http.server.response.body.size',
  sseConnections: 'sse.connections',
  outboxLag: 'outbox.lag',
  roomStageDuration: 'room.stage_duration',
} as const;
