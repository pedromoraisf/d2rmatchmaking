# Stream egress — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: no (event payloads and
timers; no new endpoint, no auth, no secret). The API change drops fields from stream events; its offline push already exists (SEG-04).

## Problem

Render's free plan gives 5 GB of egress a month (ADR 005). NFR-14 (100 players at once, on the free tier) needs a
player-hour to cost about 70,000 bytes (`constraints.md`, `load-baseline.md`). The last full load run (F1,
`b7faafb`) measured **421,369 bytes per player-hour**, six times the budget and about 12,000 player-hours a month. F0 was
113,827. The maintainer accepted the F1 cost and made cutting stream bytes an F2 task (F1 `decisions.md`, 2026-11-12;
F1 `post-close.md`, "The egress regression").

What is known today:

- Every `room.*` event sends the whole `members` list to every member's site and, for `room.assigned` and
  `room.run_opened`, to each member's agent. The agent's copy of `room.stage_changed` carries `members`, and the agent
  reads only `roomId` and `stage` (`http/sse.rs`).
- The site re-reads the agent's presence every 10 s while it shows the agent online (`AGENT_PRESENCE_REREAD_MS`,
  ARL-06). That is 360 `GET /v1/me/agent` a player-hour, each with headers. **The load journey does not do it, so the
  number above does not include it.** The API already tells the site once, within a second of the 45 s limit (a sweep every
  second, `agents/application/sweep.ts`, a transient `agent.presence_changed`). The event is never replayed, so a stream
  that is down at that moment never learns it, and the site polls as a safety net (ARL-06).
- Nothing says which event costs how much: the harness meters bytes in total (`journey_meter_bytes`).
- The load harness's room count reads 0 (`full-summary.check.mjs` fails 1 of 9; F1 `post-close.md`).
- The nightly now runs the load test (ADR 035, `nightly-report`), so every night can report the egress number.

## Requirements

- **SEG-01** — The API SHALL send the agent's copy of `room.stage_changed` with only `roomId` and `stage`. The site's
  copy keeps what the site reads. The agent SHALL still end a held room on an `expired` or `closed` stage change, and
  SHALL accept an event that still carries `members` (an API not yet updated).
- **SEG-02** — The load summary SHALL give, for each step, the bytes of each stream event type, on the site stream and on
  the agent stream, and the rest of the metered bytes as "other" (HTTP bodies, headers, framing). It SHALL also give the
  matches per player-hour of the journey, so a bytes per player-hour figure can be read against how busy the journey
  is.
- **SEG-03** — Every stream event SHALL carry only the fields that one of its consumers reads (the site's parsers, the
  agent's parser). `docs/engineering/stream-events.md` SHALL list each event type with its fields, its consumers, the
  fields each consumer reads and its measured bytes. Each field dropped SHALL have a contract change (`asyncapi.json`
  regenerated) and a test, and no event name changes.
- **SEG-04** — WHEN an agent's last heartbeat is older than the offline limit (45 s, `presence.ts`) THEN the API SHALL
  emit `agent.presence_changed` with `online: false` to the owner's site within 15 s of that limit, once, and to nobody
  else. A viewer SHALL therefore be told within 60 s of the last heartbeat (ARL-06's bound). An agent that heartbeats
  again SHALL emit the online change as today. This holds today (AWS-15); the feature pins it with tests, because SEG-05
  stops relying on the poll.
- **SEG-05** — The site SHALL re-read the agent's presence while it shows the agent online at most 12 times an hour
  (a safety net, no longer the way offline is learned), SHALL not read while the page is hidden, and SHALL read once
  when the page becomes visible again or the stream reconnects (ARL-06). It SHALL never show an agent online more than
  60 s after its last heartbeat.
- **SEG-06** — The load journey SHALL make the site's presence reads at the rate SEG-05 allows, for every player with an
  online agent, so the measured bytes include them.
- **SEG-07** — The load summary SHALL count the rooms that reached `created` in each step's measuring window, and
  `full-summary.check.mjs` SHALL pass all its checks on a full run (today it fails the room count).
- **SEG-08** — The nightly report's load section SHALL show, per step, the bytes by event type of SEG-02 and the change
  of bytes per player-hour against the latest earlier nightly on `main` that published a report ("no previous report"
  when there is none).
- **SEG-09** — The feature's last PR SHALL state the full load run before and after (bytes per player-hour at 100
  players, by event type), and either reach 70,000 or list what remains by event type with its cost. It SHALL propose
  the new `load.bytes_per_player_hour` ceiling and baseline in `decisions.md → To confirm`; the maintainer applies
  `.quality-baseline.json` (rule 4).

## Sources

| ID     | Source                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------ |
| SEG-01 | NFR-14 (egress); F2 brief row `stream-egress`; `http/sse.rs` (`StageChanged` reads two fields)         |
| SEG-02 | NFR-14; F1 `post-close.md` (the egress regression); `load-baseline.md`; `scripts/load/k6/journey.mjs`  |
| SEG-03 | NFR-14; F1 `decisions.md` (2026-11-12, "cutting stream bytes is an F2 task"); `stream-projection.ts`   |
| SEG-04 | NFR-14; ARL-06 (60 s bound); `agents/domain/presence.ts` (`OFFLINE_AFTER_MS` 45 s)                     |
| SEG-05 | NFR-14; ARL-06; `apps/web/src/app/App.tsx` (`AGENT_PRESENCE_REREAD_MS`, 10 s)                          |
| SEG-06 | NFR-14 (verified by load test); SEG-05 (a cost the journey did not carry)                              |
| SEG-07 | F1 `post-close.md` (the room count reads 0; `full-summary.check.mjs` fails 1 of 9); F1 review, Blocked |
| SEG-08 | ADR 035; `nightly-report` NGT-05 and NGT-07; maintainer 2026-11-20 ("como esta a carga do jogo")       |
| SEG-09 | NFR-14; F1 `decisions.md` (ceiling 465,000, baseline 421,400); rule 4 (baselines are the maintainer's) |

## Requirement Traceability

| Requirement ID | Story         | Proof                                                                          |
| -------------- | ------------- | ------------------------------------------------------------------------------ |
| SEG-01         | Agent copy    | API unit test on the projection + Rust unit test + acceptance `@SEG-01`        |
| SEG-02         | Breakdown     | unit tests on the load summary + `pnpm test:load` summary                      |
| SEG-03         | Lean events   | `stream-events.md` in review + contract regeneration + unit tests per event    |
| SEG-04         | Offline push  | API unit test on a fake clock + integration test + acceptance `@SEG-04`        |
| SEG-05         | Fewer reads   | component test (fake timers, visibility) + acceptance `@SEG-05`                |
| SEG-06         | Journey reads | unit tests on the journey state + the load summary                             |
| SEG-07         | Room count    | unit tests on the summary + `full-summary.check.mjs` on a full run             |
| SEG-08         | Nightly       | unit tests in `scripts/nightly` on fixtures with and without a previous report |
| SEG-09         | Result        | the last PR description and `decisions.md` (two full load runs)                |

## Decisions (conservative defaults)

- **The offline push is the way, not a faster poll, and it already exists.** The only polling that keeps ARL-06's 60 s
  bound is one every 15 s (240 reads an hour, a third less than today), which stays several times over budget: a read
  is about the size of a small event plus its headers. The API's sweep tells the viewer once, so no API code changes
  for SEG-04; the feature adds its tests. SEG-05 only slows the read that covers a lost event.
- **Trim only what no consumer reads.** No event is renamed, merged or sent less often in this feature. A field
  a consumer does read stays until that consumer changes in the same PR.
- **Measure before cutting further.** Batch 1 builds the breakdown and the audit; the cuts of SEG-03 beyond SEG-01 are
  chosen in Batch 2 from the largest measured event types, not from guesses.
- **The 70,000 target holds unless the breakdown shows it cannot.** Whatever remains is reported by event type
  (SEG-09); raising the budget is the maintainer's decision.
- **Docker for the load run.** The load run needs Docker Hub images. If the cloud answers 429, retry with backoff; a
  gate that still cannot run is reported "not run here" and runs in the nightly (ADR 035).

## Open questions (for the maintainer, in the report)

1. Is the journey representative? It queues each player for a match every 60 s, so a player-hour holds up to about 60
   matches; a real player-hour holds one or two. If so, the 421,369 figure overstates the real cost, and the 70,000
   budget is compared against a stress journey. SEG-02 reports matches per player-hour so the question can be answered
   with numbers. Decide whether the journey's cadence changes (a load-baseline decision) or only the report.
2. ~~May the API push the offline transition (SEG-04)?~~ Answered by the code: it already does (`sweep.ts`, every
   second); no sweep is added.
3. The new `load.bytes_per_player_hour` ceiling and baseline after the cuts (SEG-09): the maintainer applies them.
