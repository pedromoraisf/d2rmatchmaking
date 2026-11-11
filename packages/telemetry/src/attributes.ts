// Standardized d2r.* attribute keys shared by the API, the site and the agent (design § Telemetry package).
// Span and metric attributes use these constants only; a key outside this list is dropped by the redacting exporters.

export const D2R_ROOM_ID = 'd2r.room.id';
export const D2R_QUEUE_MODE = 'd2r.queue.mode';
export const D2R_DIFFICULTY = 'd2r.difficulty';
export const D2R_LADDER = 'd2r.ladder';
export const D2R_ERA = 'd2r.era';
export const D2R_AGENT_VERSION = 'd2r.agent.version';
export const D2R_STREAM_KIND = 'd2r.stream.kind';
export const D2R_ROOM_STAGE = 'd2r.room.stage';
export const D2R_OUTBOX_EVENT_TYPE = 'd2r.outbox.event_type';
// How a ready check ended: accepted, declined or timed-out (RDY-10). A bounded value; no names.
export const D2R_READY_CHECK_OUTCOME = 'd2r.ready_check.outcome';
// The run number and the activity of a room (LBR-13). Bounded values; no names.
export const D2R_ROOM_RUN = 'd2r.room.run';
export const D2R_ROOM_ACTIVITY = 'd2r.room.activity';
