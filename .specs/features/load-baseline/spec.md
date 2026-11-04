# Load Baseline Specification

**Approved**: 2026-11-03 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

**Amended by the maintainer** (asked in chat, recorded in `.specs/phases/F0/decisions.md`; to confirm at the phase review):

- 2026-11-03, "A, pode descartar": one API change is allowed in this feature, the pair deadlock (T41, AD-127), as an exception to "No API code changes here" below.
- 2026-11-04, "A": the telemetry limit of 0.10 is report-only in F0 (T42, AD-128). The run reports the share and whether it is within the limit, and that does not fail the run. The reduction is a condition of setting `OTEL_EXPORTER_OTLP_ENDPOINT` in production.

**Aligned by the runner, not yet by the maintainer** (assumed, AD-129; to confirm at the phase review): 2026-11-04, after the Verifier's finding, the error rule below names the whole-step additions that design.md Revision 1 already records.

## Problem Statement

NFR-14 asks for at least 100 simultaneous players on the main journey, inside NFR-01's 2 seconds, on the free
infrastructure, "verified by a load test". Nothing measures that today: there is no k6 script, no `reports/load/`, and the
three load metrics in `.quality-baseline.json` (`load.max_concurrent_players`, `load.bytes_per_player_hour`,
`load.p95_state_latency_ms`) are `null`. The F0 exit criterion also asks the run to publish the most players and rooms the
instance holds and the bytes a player costs per hour, because the 5 GB monthly egress of the free web service only fits 100
players if each costs about 70 KB an hour. This feature builds the load run, runs it once on the walking skeleton, and
leaves its first real numbers in the baseline.

## Goals

- [ ] One command, `pnpm test:load`, starts a limited API and a fresh database, ramps virtual players through the main
      journey in steps, and stops at the first step that breaks NFR-01 or the 1% error limit (NFR-01, NFR-14).
- [ ] The run passes only if 100 simultaneous players stay inside 2 seconds (p95) with fewer than 1% errors.
- [ ] The run writes `reports/load/summary.json` with the most players and rooms held, the bytes a player costs per hour
      and the p95 state latency, in the shape the quality ratchet already reads.
- [ ] The run reports the telemetry share of the egress budget and whether it is within 10% of it (AD-097; report-only in F0, AD-128).
- [ ] The run can never touch production, a deployed service or a database it did not start.

## Out of Scope

| Feature                                                                                                          | Reason                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The short confirmation run against the deployed staging service                                                  | Needs a deployed staging service and its secrets; it is a checklist item for the maintainer in the phase review                |
| Queue, ready check, `PLAYER_SLAIN_SEEN` toward FT5, leaving a room and requeueing, the 8-player leveling variant | None of these exist in F0 (the API has only `formTestMatch`); the journey grows with the features that add them (F1 and later) |
| Changing API, site or agent code to raise capacity (Postgres pool size, a session cache, payload shrinking)      | The run finds the limit and names the bottleneck; a capacity change is a maintainer decision and a separate feature            |
| Browsers and the real agent as load generators                                                                   | Virtual players speak HTTP and SSE only; the site and agent exporters are covered by `observability-e2e`                       |
| Running the load test in pull-request CI or in `pnpm check`                                                      | It takes about 17 minutes and needs Docker; it runs on demand and at the end of each phase (Design Doc)                        |
| Grafana dashboards for the load run                                                                              | The result is a JSON summary and a short document; dashboards belong to the production operations story                        |
| Neon compute-unit and Render CPU billing numbers                                                                 | The provider reports those; the run reports the container's own CPU and memory                                                 |

---

## Assumptions & Open Questions

| Assumption / decision                  | Chosen default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Rationale                                                                                                                                                                                                                                                       | Confirmed?  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| What "the main journey" is in F0       | The steps that exist: test sign-in, pairing, the site stream, the agent stream, the 15 s heartbeat, a staging `MatchFormed` that opens a room, the host agent's `GAME_NAME_SEEN`, and the room becoming `created` on the site stream                                                                                                                                                                                                                                                                                                                                     | The Design Doc journey (queue, ready check, `PLAYER_SLAIN_SEEN`, leave, requeue) has no routes yet; the brief's seed scenario is this one                                                                                                                       | n           |
| Pace of a virtual player               | One test match every 60 s, started from the player's own pairing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Heavier than a real player (a match lasts minutes), so a pass is not flattered; one constant in one place                                                                                                                                                       | n           |
| Container limits                       | The API container runs with `--cpus 0.5` and `--memory 512m`, set by `LOAD_CPUS` and `LOAD_MEMORY`; both are written to the summary                                                                                                                                                                                                                                                                                                                                                                                                                                      | The Design Doc says "limited like the Render instance" without the CPU; the free instance is a fraction of a core, and a full core would overstate capacity. Reversible by two variables                                                                        | n           |
| Steps and windows                      | Players 25, 50, 100, 150, 200, 300, 400; each step ramps for 20 s and holds for 120 s; the measuring window is the last 90 s of the hold; 400 is the ceiling                                                                                                                                                                                                                                                                                                                                                                                                             | Design Doc "steps up until the latency passes 2 s or errors pass 1%"; the ceiling bounds the run to about 17 minutes                                                                                                                                            | n           |
| Where the numbers are read             | `p95StateLatencyMs` and `bytesPerPlayerHour` are read at the 100-player step (the NFR-14 reference point); `maxConcurrentPlayers` is the highest passing step; `maxConcurrentRooms` is the rooms in stage `created` at the end of that step                                                                                                                                                                                                                                                                                                                              | A per-player number read at the limit step would drift with the ramp; F0 has no route that closes a room, so rooms accumulate for the whole run and the number is cumulative. F1 replaces it                                                                    | n           |
| Bytes per player-hour                  | Bytes received by all virtual players (headers included) in the measuring window of the 100-player step, divided by 100 players and the window in hours; setup requests are outside the window. The budget line is 70 000                                                                                                                                                                                                                                                                                                                                                | Render bills outbound bytes; `docs/engineering/constraints.md` sets about 70 KB; the ratchet ceiling is 70 000                                                                                                                                                  | n           |
| Telemetry share (AD-097)               | The API exports telemetry to a local byte-counting sink during the run. The measured bytes a month at 100 players for 720 hours are reported against 10% of 5 GiB, report-only in F0 (AD-128); the relay's allowance (16 MiB a day) is reported next to it, not added                                                                                                                                                                                                                                                                                                    | The relay allowance alone is 9.4% of 5 GiB, so adding it would fail a budget that AD-097 set from it; the maintainer may want the sum (worst case about 19%), see the decisions file                                                                            | n           |
| Distinct client addresses              | Each virtual player sends its own `X-Forwarded-For` value; the API's `TRUST_PROXY_HOPS` default of 1 reads it as the client address                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pairing allows 10 code requests an hour per address and no constant may change; Design confirms the trust rule against `apps/api/src/main/app.ts` and falls back to restarting the API                                                                          | n           |
| What runs where                        | The host needs Docker only. Postgres 17, the API and k6 (built with an SSE extension and pinned) run as containers on one network                                                                                                                                                                                                                                                                                                                                                                                                                                        | AGENTS.md: no system install beyond `pnpm install` and Docker (already used by Testcontainers); k6 core has no SSE                                                                                                                                              | n           |
| A run that misses the minimum          | It is a finding: the summary says `passed: false`, names the step and the first failed rule, and the feature reports the bottleneck. No API code changes here                                                                                                                                                                                                                                                                                                                                                                                                            | Conservative: smallest scope; a capacity change is a product and infrastructure decision                                                                                                                                                                        | n           |
| Smoke profile                          | `pnpm test:load:smoke` runs 5 players for 30 s with the same rules and writes `smoke-summary.json`, never `summary.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The proofs of this feature need a cheap run; the ratchet must never read a smoke number                                                                                                                                                                         | n           |
| How the API reaches the telemetry sink | The sink runs as a container and the API container joins its network namespace (`--network container:<sink>`), so the API exports to `http://127.0.0.1:<port>`; the other containers reach the API through the sink container's name on the run's network. The resource limits stay on the API container                                                                                                                                                                                                                                                                 | `apps/api/src/main/config.ts` accepts `http` only on a loopback host (`localhost`, `::1`, `127.*`) and `https` otherwise; a sink on its own address would stop the API at start, and no API code changes here                                                   | n           |
| Postgres with TLS                      | The Postgres 17 container starts with TLS on, using a throwaway CA and a server certificate generated for each run and valid for the container's name on the run's network; the API container trusts that CA through `NODE_EXTRA_CA_CERTS` and reaches the database by that name. The files live in a temporary directory removed with the containers                                                                                                                                                                                                                    | `main/render.ts` builds its pool with `ssl: { rejectUnauthorized: true }` (Neon takes TLS only) and the certificate is verified, never skipped; a stock Postgres container serves no TLS, and no API code changes here, so the database is the part that adapts | n           |
| Environment the API container gets     | `DATABASE_URL` for the TLS database, `PORT`, `SITE_ORIGIN` set to one fixed origin, `NODE_EXTRA_CA_CERTS`, `OTEL_EXPORTER_OTLP_ENDPOINT` for the sink, `D2RMM_ENV=staging` and `ENABLE_STAGING_ENDPOINTS=true`. Every virtual player sends that origin in the `Origin` header on its POST requests                                                                                                                                                                                                                                                                       | `requireSameOrigin` rejects a request whose origin differs from `SITE_ORIGIN` (default `http://localhost:8788`); `render.ts` listens on `0.0.0.0`, so k6 reaches it over the run's network                                                                      | n           |
| Composition root of the API under test | The `main/render.ts` root with `D2RMM_ENV=staging` and `ENABLE_STAGING_ENDPOINTS=true`, not `main/local.ts`; `D2RMM_ACCEPTANCE` stays unset                                                                                                                                                                                                                                                                                                                                                                                                                              | `render.ts` runs the real clock, needs `D2RMM_ENV=staging` for the staging endpoints and refuses `D2RMM_ACCEPTANCE`; it is the code that ships                                                                                                                  | n           |
| What an error is, and the ratio        | An error is a journey request answered with a non-2xx status (a `429` included), a stream that closes while its player runs, or an iteration whose `created` frame has not arrived 5 s after its observation. The error ratio of a step is its errors over its journey requests plus its iterations, all inside the measuring window, and the lost assignments and dropped arrivals of the whole step are added to the errors on purpose, which makes the figure conservative (AD-129). A `created` frame that arrives after 2 s but within 5 s is latency, not an error | One formula that a unit test can pin; 5 s is 2.5 times the 2 s limit, so a slow answer shows up in the p95 before it counts as an error                                                                                                                         | n           |
| Trace sampling during the run          | The API runs with the default sampler ratio (`OTEL_TRACES_SAMPLER_ARG` unset, 0.1, AD-089) and the global 20 traces a second cap (AD-100)                                                                                                                                                                                                                                                                                                                                                                                                                                | The telemetry share must describe what production would send; the sampler is not tuned for the run                                                                                                                                                              | n           |
| Numbers of a step that never ran       | `p95StateLatencyMs`, `bytesPerPlayerHour`, `telemetryBytesPerPlayerHour`, `telemetryMonthlyBytes` and `telemetryShareOfBudget` are `null` when the 100-player step did not run; `maxConcurrentPlayers` is 0 and `maxConcurrentRooms` is the rooms in `created` at the end of the highest passing step, or 0. `pnpm quality:collect` reads `null` as not measured                                                                                                                                                                                                         | A made-up number would pass or fail the ratchet for the wrong reason                                                                                                                                                                                            | n           |
| Pure rules are unit-tested (ADR 026)   | The step verdict, the summary arithmetic, the target guard, the telemetry share and the publish guard are pure functions with colocated unit tests                                                                                                                                                                                                                                                                                                                                                                                                                       | A rule only the assembled run can observe is extracted and unit-tested; mutation never runs the load test                                                                                                                                                       | y - ADR 026 |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: A staged ramp of the main journey ⭐ MVP

**User Story**: As the maintainer, I want one command that ramps virtual players through the main journey in steps against
an API limited like the free instance, so that I learn how many players it holds inside 2 seconds.

**Why P1**: F0 exit criterion "Load test of the main journey passes ≥ 100 concurrent players" (NFR-14, NFR-01).

**Acceptance Criteria**:

1. WHEN the maintainer runs `pnpm test:load` THEN the system SHALL start a new Postgres 17 container with TLS on (a throwaway certificate per run, trusted by the API container) and the API in a container limited to `LOAD_CPUS` CPUs (default 0.5) and `LOAD_MEMORY` (default 512m), and SHALL run k6 against that API.
2. The API under test SHALL run from the `main/render.ts` composition root with the real clock, the staging endpoints on (`D2RMM_ENV=staging`, `ENABLE_STAGING_ENDPOINTS=true`) and the acceptance test controls off, with `SITE_ORIGIN`, `PORT`, the database URL and the CA path set for the run, and SHALL export its telemetry over loopback to a sink in the same network namespace that counts bytes.
3. WHEN a virtual player starts THEN it SHALL sign in with a unique test name, pair one agent through the pairing-code flow, open the site stream and the agent stream, and send the agent heartbeat every 15 s until it stops.
4. The virtual players SHALL present distinct client addresses and SHALL NOT change a rate-limit constant, and IF a request of the journey is answered `429` THEN the system SHALL count it as an error.
5. WHILE a virtual player runs, every 60 s it SHALL start a test match, WHEN its agent stream delivers `room.assigned` THEN it SHALL post `GAME_NAME_SEEN` with the expected game name as the host, and SHALL then wait for `room.stage_changed` with stage `created` on its site stream.
6. The state latency of an iteration SHALL be the time from sending the observation to receiving the `created` frame, and the system SHALL compute the p95 of every step over its measuring window.
7. WHEN the full profile runs THEN the system SHALL run the steps 25, 50, 100, 150, 200, 300 and 400 players in order, each ramping for 20 s and holding for 120 s with the last 90 s as its measuring window, and SHALL stop after the first step that fails or after 400.
8. A step SHALL pass only if its p95 state latency is at most 2000 ms, its error ratio (errors over journey requests plus iterations in the measuring window, as the Assumptions define errors, the whole step's lost assignments and dropped arrivals included) is below 1%, and the API container neither restarted nor was killed during it.
9. WHERE `LOAD_PROFILE=smoke` THEN the system SHALL run one step of 5 players holding for 30 s under the same rules and SHALL mark the summary `profile: "smoke"`.

**Independent Test**: run `pnpm test:load:smoke` with Docker running and read `reports/load/smoke-summary.json`.

---

### P1: A result that is published and fails loudly ⭐ MVP

**User Story**: As the maintainer, I want the run to state the most players and rooms the instance holds and what a player
costs in bytes, and to fail when the minimum is missed, so that the ratchet gets real numbers and a regression cannot
pass silently.

**Why P1**: F0 exit criteria "publishes max players/rooms and bytes per player-hour" and "`.quality-baseline.json` has first real values for … load" (NFR-14).

**Acceptance Criteria**:

1. The system SHALL set `maxConcurrentPlayers` to the players of the highest step that passed with every earlier step passing, and to 0 when the first step fails.
2. IF the 100-player step does not pass THEN the system SHALL exit non-zero, write `passed: false` and a `failure` field naming the step and the first failed rule, one of `latency`, `errors` or `container`.
3. WHEN the run ends THEN the system SHALL write `reports/load/summary.json` (`reports/load/smoke-summary.json` for the smoke profile) whole or not at all, also on failure, with the top-level numbers `maxConcurrentPlayers`, `maxConcurrentRooms`, `bytesPerPlayerHour` and `p95StateLatencyMs` under exactly those names.
4. The system SHALL set `p95StateLatencyMs` to the p95 of the 100-player step, `maxConcurrentRooms` to the rooms in stage `created` in the database at the end of the highest passing step, and `bytesPerPlayerHour` to the bytes received by all virtual players, headers included, in the 100-player step's measuring window divided by 100 players and the window in hours.
5. The system SHALL also write `passed`, `profile`, the CPU and memory limits, the tool and image versions, the git commit, the start and end times, `withinEgressBudget` (true when `bytesPerPlayerHour` is at most 70 000), and one row per step with its players, p95, error ratio, bytes received, peak API CPU percent and peak API memory.
6. WHEN the maintainer runs `pnpm load:publish` with a full summary that passed THEN the system SHALL write `docs/engineering/load-baseline.md` with the numbers, the limits, the date and the commit, and IF the summary is missing, smoke or not passed THEN it SHALL refuse and write nothing.

**Independent Test**: unit tests of the summary builder with fixed step results; then `pnpm test:load` and `pnpm quality:collect` reading the three metrics.

---

### P2: A run that cannot hurt anything

**User Story**: As the maintainer, I want the run to refuse anything but its own containers and to clean up after itself,
so that a mistyped variable never loads production and no container is left running.

**Why P2**: AGENTS.md rules 6 and 7 (no production database, no deployed target); the run is dangerous in a way no other test is.

**Acceptance Criteria**:

1. IF `LOAD_TARGET` or `DATABASE_URL` is set to a non-empty value (a loopback address included, since the run starts its own containers) THEN the system SHALL refuse before starting a container or sending a request and SHALL name the offending variable; an unset or empty variable SHALL be ignored.
2. IF Docker is not installed or its daemon is not running, or the k6 image cannot be built or pulled, THEN the system SHALL fail before starting any container and SHALL name Docker, or the image when only the image failed.
3. WHEN the run ends in any way, including a failed step or an interrupt, THEN the system SHALL remove the containers and the network it created.
4. The load run SHALL NOT be part of `pnpm check`, `pnpm test` or the pull-request workflow, and SHALL be started only by `pnpm test:load` and `pnpm test:load:smoke`.

**Independent Test**: run the command with `LOAD_TARGET=https://api.example.com` and see the refusal; run it with no Docker on the path and see the message.

---

### P2: The cost of telemetry stays inside its budget

**User Story**: As the maintainer, I want the run to report how many bytes the API sends to the telemetry backend and to
fail when they pass 10% of the monthly egress, so that observability never eats the budget the players need (AD-097).

**Why P2**: AD-097 queued this for `load-baseline`'s Specify; NFR-14's 5 GB figure is shared with telemetry.

**Acceptance Criteria**:

1. The system SHALL write `telemetryBytesPerPlayerHour` (bytes the API exported to the sink in the 100-player step's measuring window, per player and hour), `telemetryMonthlyBytes` (that figure times 100 players times 720 hours), `relayAllowanceMonthlyBytes` (16 MiB times 30) and `telemetryShareOfBudget` (`telemetryMonthlyBytes` over 5 GiB) to the summary.
2. The system SHALL write `withinTelemetryBudget` to the summary (false when `telemetryShareOfBudget` is above 0.10, true at or below it, `null` when the 100-player step never ran) and SHALL show it in the published baseline as report-only, with the condition on the production endpoint. It SHALL NOT change `passed`, `failure` or the exit code in F0 (AD-128).

**Independent Test**: unit tests of the share arithmetic at 0.10 and just above; the number in the full run's summary.

---

## Edge Cases

- IF the API container exits or is killed during a step THEN that step SHALL fail with `container` and the run SHALL end there (LB-08).
- WHEN a virtual player joins during a ramp THEN its setup requests SHALL fall outside the measuring window and SHALL NOT count toward bytes or latency (LB-14).
- IF a `created` frame does not arrive within 5 s of the observation THEN the system SHALL count one error for that iteration (LB-08).
- WHEN the 400-player step passes THEN the summary SHALL say `ceilingReached: true` and the run SHALL exit 0 (LB-10).
- IF the full run passes the minimum but a later step fails THEN the run SHALL exit 0 and `maxConcurrentPlayers` SHALL hold the last passing step (LB-10, LB-11).
- IF the 100-player step did not run or did not pass THEN `p95StateLatencyMs`, `bytesPerPlayerHour` and the telemetry numbers SHALL be `null` when the step never ran, and the run SHALL exit non-zero (LB-11, LB-13).

---

## Requirement Traceability

| Requirement ID | Story                                                    | Phase  | Status  |
| -------------- | -------------------------------------------------------- | ------ | ------- |
| LB-01          | P1: A staged ramp of the main journey (AC 1)             | Design | Pending |
| LB-02          | P1: A staged ramp of the main journey (AC 2)             | Design | Pending |
| LB-03          | P1: A staged ramp of the main journey (AC 3)             | Design | Pending |
| LB-04          | P1: A staged ramp of the main journey (AC 4)             | Design | Pending |
| LB-05          | P1: A staged ramp of the main journey (AC 5)             | Design | Pending |
| LB-06          | P1: A staged ramp of the main journey (AC 6)             | Design | Pending |
| LB-07          | P1: A staged ramp of the main journey (AC 7)             | Design | Pending |
| LB-08          | P1: A staged ramp of the main journey (AC 8)             | Design | Pending |
| LB-09          | P1: A staged ramp of the main journey (AC 9)             | Design | Pending |
| LB-10          | P1: A result that is published and fails loudly (AC 1)   | Design | Pending |
| LB-11          | P1: A result that is published and fails loudly (AC 2)   | Design | Pending |
| LB-12          | P1: A result that is published and fails loudly (AC 3)   | Design | Pending |
| LB-13          | P1: A result that is published and fails loudly (AC 4)   | Design | Pending |
| LB-14          | P1: A result that is published and fails loudly (AC 4)   | Design | Pending |
| LB-15          | P1: A result that is published and fails loudly (AC 5)   | Design | Pending |
| LB-16          | P1: A result that is published and fails loudly (AC 6)   | Design | Pending |
| LB-17          | P2: A run that cannot hurt anything (AC 1)               | Design | Pending |
| LB-18          | P2: A run that cannot hurt anything (AC 2)               | Design | Pending |
| LB-19          | P2: A run that cannot hurt anything (AC 3)               | Design | Pending |
| LB-20          | P2: A run that cannot hurt anything (AC 4)               | Design | Pending |
| LB-21          | P2: The cost of telemetry stays inside its budget (AC 1) | Design | Pending |
| LB-22          | P2: The cost of telemetry stays inside its budget (AC 2) | Design | Pending |

LB-13 stands for the two values of AC 4 that name where a number is read (`p95StateLatencyMs`, `maxConcurrentRooms`); LB-14 stands for the `bytesPerPlayerHour` definition in the same criterion.

---

## Sources

- `docs/product/prd.md#NFR-14` - at least 100 simultaneous players on the main journey, inside NFR-01, on the free infrastructure, verified by a load test → LB-01, LB-03, LB-05, LB-07, LB-08, LB-10, LB-11
- `docs/product/prd.md#NFR-01` - a room state change reaches the site within 2 s of the agent's observation → LB-05, LB-06, LB-08
- `docs/architecture/design-doc.md` § Teste de carga - the journey, the steps up to 2 s or 1% errors, the 100-player minimum, the result to record, the container limited like Render, 70 KB per player-hour → LB-01, LB-05, LB-07, LB-08, LB-12…LB-15
- `docs/engineering/constraints.md` - Render egress 5 GB a month, about 70 KB per player-hour → LB-14, LB-15, LB-21, LB-22
- `docs/engineering/testing.md` - load level: k6 with an SSE extension in `tests/load`, on demand and at the phase review → LB-01, LB-20
- ADR 026 (mutation against unit tests only) - pure rules extracted and unit-tested; the load run is never a mutation proof → LB-08, LB-10, LB-13, LB-17, LB-22
- ADR 023 (BDD acceptance) - the two scenarios that can run without a load, tagged `@LB-17` and `@LB-18` → LB-17, LB-18
- AD-097 (`.specs/phases/F0/decisions.md`, queued for `load-baseline`) - report the telemetry share and fail above 10% of the 5 GB monthly egress → LB-21, LB-22
- `.specs/features/api-web-skeleton/spec.md` (the staging endpoints, pairing limits, the stream) and `.specs/features/observability-e2e/spec.md` (the exporter and its sampler) - the surface the virtual players use → LB-02, LB-03, LB-04, LB-05
- `.specs/phases/F0/brief.md` - exit criteria "Load test of the main journey passes ≥ 100 concurrent players and publishes max players/rooms and bytes per player-hour" and "`.quality-baseline.json` has first real values for … load" → LB-10…LB-16
- `.quality-baseline.json` - `load.max_concurrent_players` (floor 100), `load.bytes_per_player_hour` (ceiling 70 000), `load.p95_state_latency_ms` (ceiling 2000), read from `reports/load/summary.json` → LB-12, LB-13, LB-14
- AGENTS.md rules 6 and 7 (secrets, no production, blast radius) → LB-17, LB-19

---

## Success Criteria

- [ ] `pnpm test:load` ends with `passed: true` in `reports/load/summary.json`: `maxConcurrentPlayers` is at least 100, `p95StateLatencyMs` is at most 2000 and the error ratio of the 100-player step is below 1%.
- [ ] The summary holds `maxConcurrentRooms`, `bytesPerPlayerHour` and the telemetry numbers, and `withinTelemetryBudget` says whether `telemetryShareOfBudget` is at most 0.10.
- [ ] `pnpm quality:collect` reads the three load metrics from the summary and `pnpm quality:ratchet --context phase --update` records them as the first baseline values.
- [ ] `pnpm test:load` with a target that is not its own container is refused, and with Docker missing it fails naming Docker; no container is left after any run.
- [ ] `pnpm check` and `pnpm test:acceptance` stay green and `pnpm check` runs no load.
