# Stream events

Audit for `stream-egress` (SEG-03). `GET /v1/stream` carries ten event types to two kinds of reader: the site (session
cookie) and the agent (bearer token). Render's free plan has 5 GB of egress a month (ADR 005); NFR-14 needs a player-hour
to cost about 70,000 bytes. The load run measures 421,369. This page says what each event carries, who reads which field,
and what no one reads, so a field is dropped only when no consumer reads it (`spec.md` decision "Trim only what no consumer
reads").

Sources of truth: the contracts (`packages/contracts/src/events/stream.ts`), the projection that builds each message
(`apps/api/src/platform/stream-projection.ts`), the site's reducer (`apps/web/src/app/site-state.ts`, `App.tsx`) and the
agent's parser (`apps/agent/src-tauri/adapters/src/http/sse.rs`).

## How the sizes were taken

- **Frame bytes (sample)**: the bytes of one frame as the API writes it (`event:` line, `data:` line, blank line) for a
  typical payload (UUID ids, a two-member room, a ten-character game name). Computed with `frameBytes` of
  `scripts/load/lib/journey-state.mjs`. They show the order of magnitude and what a trim saves; they are not a run.
- **Measured**: the load run's `bytesByEvent` per player-hour (T1). The first column of numbers comes from a nightly
  (`load` suite, ADR 035); until one has run on this branch, the measured column of a PR is the one in its description.

## The events

| Event                    | Sent to                                           | Fields                                                                                                   | Frame bytes (sample) |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| `room.assigned`          | site, agent                                       | `roomId`, `run`, `expectedGameName`, `members[]`                                                         | 436                  |
| `room.stage_changed`     | site (all stages), agent (`expired` and `closed`) | `roomId`, `stage`, `members[]`                                                                           | 419                  |
|                          | agent's copy                                      | `roomId`, `stage` (lean since SEG-01)                                                                    | 101 (was 419)        |
| `room.run_opened`        | site, agent                                       | `roomId`, `run`, `expectedGameName`, `members[]`                                                         | 438                  |
| `room.member_changed`    | site                                              | `roomId`, `change`, `accountId`, `members[]`                                                             | 474                  |
| `agent.presence_changed` | site (owner)                                      | `agentId`, `online`, `gameRunning`, `screen`                                                             | 149                  |
| `characters.updated`     | site                                              | none (`{}`)                                                                                              | 36                   |
| `queue.updated`          | site                                              | the ticket (`id`, `status`, `mode`, `options`, `joinedAt`, `band`, `poolSize`) or `left` with its reason | 250 (waiting)        |
| `ready_check.started`    | site, agent                                       | `id`, `mode`, `difficulty`, `deadline`, `now`, `members[]`                                               | 343                  |
| `ready_check.updated`    | site                                              | the same view with new marks                                                                             | about 343            |
| `ready_check.resolved`   | site, agent                                       | `id`, `outcome`                                                                                          | 102                  |

A `members[]` entry is `accountId`, `characterId`, `joinOrder`, `role`, optional `team` and `confirmed`: about 170 bytes
for a member in a room.

## Who reads what

| Event                    | Site reads                                                                                    | Agent reads                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `room.assigned`          | `roomId`, `expectedGameName`, `run`; per member `accountId`, `joinOrder`, `role`, `confirmed` | `roomId`, `run`, `expectedGameName`; **`members` not read**           |
| `room.stage_changed`     | `roomId`, `stage`; per member `accountId`, `joinOrder`, `role`, `confirmed`                   | `roomId`, `stage` only                                                |
| `room.run_opened`        | `roomId`, `run`, `expectedGameName`; the same member fields                                   | `roomId`, `run`, `expectedGameName`; **`members` not read**           |
| `room.member_changed`    | `roomId`, `change`, `accountId`; the same member fields                                       | not sent                                                              |
| `agent.presence_changed` | all four fields                                                                               | not sent                                                              |
| `characters.updated`     | the event name only (it refetches the list)                                                   | not sent                                                              |
| `queue.updated`          | the whole view                                                                                | not sent                                                              |
| `ready_check.started`    | the whole view                                                                                | `id`, `deadline`, `now`; **`mode`, `difficulty`, `members` not read** |
| `ready_check.updated`    | the whole view                                                                                | not sent                                                              |
| `ready_check.resolved`   | `id` (the outcome is not shown)                                                               | `id`; **`outcome` not read**                                          |

## What no consumer reads

| Event and field                                                    | Sent to | Saves per event (two members) |
| ------------------------------------------------------------------ | ------- | ----------------------------- |
| `room.stage_changed` `members` (agent's copy)                      | agent   | 318 bytes, **done (SEG-01)**  |
| `room.assigned` and `room.run_opened` `members`                    | agent   | about 340 bytes each          |
| `ready_check.started` `mode`, `difficulty`, `members`              | agent   | about 230 bytes               |
| `ready_check.resolved` `outcome`                                   | agent   | about 22 bytes                |
| member `characterId` and `team`, in every event that lists members | site    | about 50 bytes a member       |

The site's `room.stage_changed` carries the members only so the confirmed marks stay current; a stage change that changes no
mark could carry none, which is a change to the site's reducer, not a dropped field (batch 2 decides it from the measured
sizes).

## Safety nets, not events

The site reads the agent's presence again every 5 minutes (12 an hour) while the page is in view, and once when it comes back
into view or the stream reconnects (SEG-05, ARL-06). The API tells the site once when an agent goes quiet (the sweep of
`agents/application/sweep.ts`, SEG-04); a stream that is down at that moment never learns it, so the read stays.

## Rules for a change

- A field leaves an event only when this page says no consumer reads it, in the same PR that changes the consumer's
  parser.
- The event name does not change. The contract (`asyncapi.json`) is regenerated and the agent's own schema (typify,
  `packages/contracts/src/documents.ts` `JSON_SCHEMA_SOURCES`) follows when the agent's copy changes.
- The agent accepts an event that still carries a dropped field, so an API and an agent of different versions work together.
