# Site Stale Read Fix Specification

**Approved**: 2026-11-05 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

A read of the room that started before an observation's commit can answer after the `room.stage_changed` event reached the site, and the site writes that older answer over the event. The player then stays on "Awaiting host" until they reload. The first GitHub runs of `phase/F0` at `c7a4dda` failed `@AWS-23` this way, which breaks NFR-01: the room stage reaches the site within 2 s of the observation.

The trace of run `42053404931` shows the read leaving at `20.601` and answering `awaiting_host` at `20.629`, around an observation sent from `20.602` to `20.627`. It does not record the stream's content, so the event's arrival inside that window is inferred. T1 reproduces the order in a unit test before any fix.

## Goals

- [ ] A read that answers after a stream event arrived never undoes that event on screen.
- [ ] The site ends on the server's current state after such a read, with one more read.
- [ ] A read with no event during it behaves as it does today.

## Out of Scope

| Feature                                                 | Reason                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Two overlapping reads answering out of order, no event  | Nothing has failed on it; a risk in `review.md`, out by brief revision 4   |
| Any API, contract or stream change                      | The API publishes after the commit, so the site alone can order the two    |
| Retries of the acceptance suite or a longer 2 s timeout | They would hide the defect; `retries: 0` stands (ADR 022, ADR 023)         |
| A limit on how many times the site reads again          | Each new read needs a new event during the last one, and reads take ~30 ms |
| Making `integration` a required check on `main`         | The maintainer's decision, listed in `review.md`                           |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here - nothing is left silently unclear.

| Assumption / decision                         | Chosen default                                                  | Rationale                                                                                                               | Confirmed?           |
| --------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------- |
| What the site does with the older answer      | It ignores the whole answer, agent and room, and reads again    | The event is published after the commit, so a read that starts after the event sees that commit                         | y - brief revision 4 |
| Which events make a read stale                | Every stream event, whatever its type                           | A rule per event type would keep a presence event from discarding a room read, with more code and no case that needs it | n - AD-133, assumed  |
| What the new read does when it fails          | It keeps what is on screen, the rule every read already follows | The event's stage is the newest thing the site knows                                                                    | n - AD-134, assumed  |
| What happens if the first proof does not fail | The feature stops and returns to the maintainer                 | The cause is inferred from the trace; a fix for a cause that does not reproduce would leave the failure in place        | y - brief revision 4 |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: A late answer does not undo the stream ⭐ MVP

**User Story**: As a player, I want the room's stage to stay as the stream delivered it so that a slow read never puts my room back on an older stage.

**Why P1**: without it, a player can stay on "Awaiting host" after the room was created, and `integration` fails on timing.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. SSR-01: WHEN a stream event reaches the site while a read of the agent and the room is in flight THEN the site SHALL ignore the answer of that read
2. SSR-02: WHEN a read finishes, with an answer or a failure, after a stream event reached the site while it was in flight THEN the site SHALL start a new read of the agent and the room
3. SSR-03: WHEN a read answers with a room and no stream event reached the site while it was in flight THEN the site SHALL show that answer
4. SSR-04: IF the new read fails THEN the site SHALL keep on screen the stage the stream delivered
5. SSR-05: WHEN a read answers that there is no room and no stream event reached the site while it was in flight THEN the site SHALL clear the room on screen

**Independent Test**: hold the site's read of the room, report the game name as the agent, see "Created", release the held answer, and see the site read again and still show "Created".

---

## Edge Cases

- SSR-04 covers a new read that fails.
- SSR-05 covers a read that answers "no room" with no event during it.
- SSR-02 covers a stale read that fails instead of answering: the new read still happens. The unit test `reads again when a read fails after a stream event` proves it.
- "A read" means every read the site starts while signed in: on stream open, after sign-in, after pairing and after a test match starts. They share one function. The scenarios use the stream-open read, and the unit test `ignores a test match read that answers after a stream event` proves another entry. The read the site makes while it loads is not one of them: its stream opens only after that read, so no event can reach the site during it.
- An event that arrives during the new read makes that read stale too, by SSR-01 and SSR-02.
- The API sends no event when a stream opens without `Last-Event-ID` (`stream-hub.ts:264-268`), so the `@SSR-03` scenario has no event during its read.
- A failed read in a scenario is a server error. A 404 means "no room" and clears the room (SSR-05).
- The `@SSR-01 @SSR-04` scenario tells ignoring the late answer from applying it, because its new read fails. The `@SSR-01 @SSR-02` scenario ends on "Created" either way, so it proves the new read, and the unit test on the held new read proves the screen between the two.
- Stream delivery is at least once (ADR 008): a duplicate event during a read costs one more read and changes nothing on screen. The unit test `a repeated event during a read costs one more read` proves it.
- The answer held in a scenario is the server's real answer, taken before the agent reports, so it says `awaiting_host`. That is what lets a scenario tell ignoring the answer from applying it.
- A scenario that says "within 2 seconds" carries `@NFR-01`. The others use the plain step, because NFR-01 measures from the observation and they have no event to measure.

---

## Requirement Traceability

| Requirement ID | Story                                      | Phase | Status  |
| -------------- | ------------------------------------------ | ----- | ------- |
| SSR-01         | P1: A late answer does not undo the stream | Tasks | Pending |
| SSR-02         | P1: A late answer does not undo the stream | Tasks | Pending |
| SSR-03         | P1: A late answer does not undo the stream | Tasks | Pending |
| SSR-04         | P1: A late answer does not undo the stream | Tasks | Pending |
| SSR-05         | P1: A late answer does not undo the stream | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 5 total, 5 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-4.md` - the defect and the change, approved by the maintainer ("Pelo fluxo da fase") → SSR-01, SSR-02, SSR-04
- `apps/web/src/app/App.tsx:76` - today's rule: a read's answer shows, and "no room" clears the room. SSR-03 and SSR-05 guard this existing behaviour against the fix; they add none → SSR-03, SSR-05
- `docs/product/prd.md#NFR-01` - the room stage on the site within 2 s of the observation → SSR-01, SSR-02
- ADR 007 - one SSE stream, updates under 2 s → SSR-01, SSR-02
- `apps/web/src/app/App.tsx:94` - the site re-reads on every stream open, so a lost event is never stale → SSR-02, SSR-03, SSR-05
- ADR 008 - events are published after the commit, which makes the new read current; delivery is at least once → SSR-02
- ADR 023 - acceptance scenarios, `retries: 0` → SSR-01 to SSR-05
- AD-133 and AD-134 in `.specs/STATE.md` - which events make a read stale, and what a failed new read does → SSR-01, SSR-04

---

## Success Criteria

- [ ] `@SSR-*` scenarios pass locally with the held answer, so they do not depend on timing.
- [ ] `@AWS-23` passes in the CI `integration` job, after the maintainer's go-ahead to push.
