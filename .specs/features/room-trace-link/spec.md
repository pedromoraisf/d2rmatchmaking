# Room Trace Link Specification

**Approved**: 2026-11-07 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

A room leaves two traces with no link between them (AD-092). Trace A starts at the site's "Start test match" and ends at the delivery of the `awaiting_host` stage. Trace B starts at the agent's observation and ends at the delivery of `created`. Exit criterion 8 of F0 asks for one trace from the click to the stream with the agent linked, so from trace B nobody can reach the match that opened the room. The maintainer chose a span link on 2026-11-07 and decided that F0 closes with it (brief revision 5).

## Goals

- [ ] From the agent's trace of a room, the trace of the match that opened the room is one span link away.
- [ ] Nothing a player, the site or the agent sees changes.
- [ ] A room with no stored trace, as in production today, behaves exactly as before.

## Out of Scope

| Feature                                                       | Reason                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Contract, agent and site changes                              | The link is made in the API (brief revision 5)                                   |
| The browser's receipt of the stream                           | AD-086 stands                                                                    |
| Telemetry in production builds, the privacy notice and volume | Decided by the maintainer on 2026-11-07 for F1 (`.specs/phases/F0/decisions.md`) |
| A link from trace A to trace B                                | Trace A ends before trace B starts; a link is added when a span starts or runs   |
| Links on any span other than `lobby.record-observation`       | One link from the span that moves the room is enough to reach trace A            |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision                             | Chosen default                                                                                    | Rationale                                                                                                                 | Confirmed?           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Link or one shared trace                          | A span link from trace B to trace A; both traces keep their roots                                 | The maintainer's choice at the F0 review                                                                                  | y - brief revision 5 |
| Which context the room stores                     | The context active when `lobby.on-match-formed` opens the room, the outbox relay of `MatchFormed` | That relay span is a child of the stored context of trace A (OBS-07), so it sits in trace A                               | y - brief revision 5 |
| A context whose sampled flag is off               | Stored and linked like any other                                                                  | The link costs nothing when trace A was not exported; a rule per flag adds code with no case that needs it                | n - AD-135, assumed  |
| An observation from an agent that is not a member | No link                                                                                           | The span only links rooms the agent may act on; the answer stays 403 and nothing about the room is read for a stranger    | n - AD-136, assumed  |
| How the link appears in the backend               | The OpenTelemetry span link, with no attributes                                                   | Grafana's trace view lists span links and opens the linked trace; attributes would add nothing the trace id does not give | n - AD-137, assumed  |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: The agent's trace leads to the match ⭐ MVP

**User Story**: As the maintainer, I want the agent's trace of a room to link to the trace of the match that opened it so that I can follow a room from the click to `created`.

**Why P1**: exit criterion 8 of F0, and the maintainer's decision that F0 closes with it.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. RTL-01: WHEN `lobby.on-match-formed` opens a room THEN the API SHALL store with the room the W3C `traceparent` of the context active at that moment
2. RTL-02: IF no valid span context (a non-zero trace id and span id) is active when `lobby.on-match-formed` opens a room THEN the API SHALL store no `traceparent` for that room
3. RTL-03: WHEN `lobby.record-observation` runs for a room that has a stored `traceparent` and the agent's account is a member of that room THEN the `lobby.record-observation` span SHALL carry exactly one span link, whose trace id and span id are those of the stored `traceparent`
4. RTL-04: IF the room has no stored `traceparent` THEN the `lobby.record-observation` span SHALL carry no span link and the API SHALL answer the observation as it does today
5. RTL-05: IF the stored `traceparent` is not a valid W3C `traceparent` THEN the `lobby.record-observation` span SHALL carry no span link and the API SHALL answer the observation as it does today
6. RTL-06: IF the room does not exist or the agent's account is not a member of it THEN the `lobby.record-observation` span SHALL carry no span link and the API SHALL answer 403 as it does today
7. RTL-07: The API SHALL keep the stored `traceparent` out of every HTTP response, outbox event payload and stream message
8. RTL-08: WHEN the API's migrations run THEN they SHALL add the room's `traceparent` as a nullable column, and a room opened before that migration SHALL read as having no stored `traceparent`
9. RTL-09: WHEN the agent's observation moves a room opened by a test match from the site to `created` THEN the telemetry backend SHALL hold, within 30 seconds, the trace whose root is the agent's observation span, and its `lobby.record-observation` span SHALL link to the trace whose root is the site's "Start test match" action, by that trace's id

**Independent Test**: start the local telemetry backend, start a test match on the site, let the headless agent report the game name, open the agent's trace and follow the link of `lobby.record-observation` to the trace that starts with the site's action.

---

## Edge Cases

- RTL-02 is production today: the site and agent builds export nothing and the API exports nothing without `OTEL_EXPORTER_OTLP_ENDPOINT` (AD-090, AD-098, AD-128), so no span context is active and rooms store none. RTL-04 then keeps every observation as it is.
- A second `MatchFormed` for the same match opens no room (`already-created`), so it stores nothing and the first room keeps its `traceparent` (RTL-01 applies only when a room opens).
- An observation repeated with the same idempotency key, or of type `UNKNOWN`, still runs `lobby.record-observation` past the membership check, so its span carries the link too (RTL-03): the link describes where the room came from, not what the observation changed.
- RTL-05 guards a value the API itself wrote. A column edited by hand, or a format change, must not break observations.
- RTL-07: the `traceparent` already travels in outbox rows' `trace_context` column (OBS-07), which is never sent to clients; the room's copy follows the same rule. `pnpm contracts:openapi` leaves no diff.
- RTL-08: the migration list of `migrate.int.test.ts` gains the new migration, an additive change like T17 of `observability-e2e`.
- RTL-09 has its own scenario instead of a new step in `observability-e2e`'s `@OBS-12` scenario: that feature's scenarios are approved and are not edited (ADR 023), at the cost of one more `@slow` run.
- The link points at a span inside trace A, the outbox relay of `MatchFormed`, not at the site's root span. RTL-03 and RTL-09 name the trace, which is what a reader follows.

Implicit dimensions: observability is the feature (RTL-01 to RTL-09); failure states (RTL-02, RTL-04, RTL-05); auth boundaries (RTL-06); idempotency (the second `MatchFormed` and repeated observations, above); data lifecycle (RTL-08; the value lives and goes with its room). Remaining dimensions N/A for this scope.

---

## Requirement Traceability

| Requirement ID | Story                                    | Phase | Status  |
| -------------- | ---------------------------------------- | ----- | ------- |
| RTL-01         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-02         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-03         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-04         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-05         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-06         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-07         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-08         | P1: The agent's trace leads to the match | Tasks | Pending |
| RTL-09         | P1: The agent's trace leads to the match | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 9 total, 9 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-5.md` - the span link and its scope, approved by the maintainer ("aprovado por pedromoraisf") → RTL-01, RTL-03, RTL-07, RTL-09
- `.specs/phases/F0/brief.md` § Exit criteria, "One trace: site click → API → Postgres → outbox → SSE; agent spans linked by `traceparent`" → RTL-03, RTL-09
- `docs/product/prd.md#NFR-09` - traces, metrics and logs in OpenTelemetry from day 0 → RTL-01, RTL-03, RTL-09
- ADR 013 - OTLP only, `traceparent` links the agent → RTL-01, RTL-03, RTL-05
- AD-092 in `.specs/STATE.md` - the two traces, reversed by the maintainer on 2026-11-07 → RTL-03, RTL-09
- AD-090, AD-098, AD-128 in `.specs/STATE.md` - no telemetry export in production today → RTL-02, RTL-04
- `.specs/features/observability-e2e/design.md` § The two traces of a room, and OBS-07 - where trace A and trace B start and end, and the outbox's stored context → RTL-01, RTL-07
- `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.ts` - `onMatchFormed` and `recordObservation`, the membership check and today's answers → RTL-04, RTL-06
- AGENTS.md rule 1 and rule 2 - the domain stays free of OpenTelemetry; no contract change → RTL-07, RTL-08
- AD-135, AD-136 and AD-137 in `.specs/STATE.md` - the sampled flag, strangers and the link's shape → RTL-03, RTL-06

---

## Success Criteria

- [ ] `@RTL-09` passes against the local telemetry backend, with the link's trace id equal to the trace that holds the site's action.
- [ ] No existing assertion is weakened: the migration list of `migrate.int.test.ts` gains one entry, every other `lobby-room` and outbox test passes as it is, and `pnpm contracts:openapi` leaves no diff.
