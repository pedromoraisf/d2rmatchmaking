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

// Ids a journey is followed by (ADR 037, OBT-03): UUIDs only, in both tiers. They are span attributes, never metric labels.
export const D2R_ACCOUNT_ID = 'd2r.account.id';
export const D2R_AGENT_ID = 'd2r.agent.id';
export const D2R_RUN_ID = 'd2r.run.id';
export const D2R_TICKET_ID = 'd2r.ticket.id';
export const D2R_READY_CHECK_ID = 'd2r.ready_check.id';
// The generated game name (`mmpvpnm-3`, ADR 017): not personal data.
export const D2R_GAME_NAME = 'd2r.game.name';

// Keys only the full tier carries (OBT-04, OBT-06, OBT-07). `STAGING_ONLY_KEYS` in redact-attributes.ts lists the same keys.
export const D2R_ACCOUNT_BATTLETAG = 'd2r.account.battletag';
export const D2R_CHARACTER_NAME = 'd2r.character.name';
export const D2R_OBSERVATION_READ_TEXT = 'd2r.observation.read_text';
export const D2R_OBSERVATION_READ_NAMES = 'd2r.observation.read_names';
