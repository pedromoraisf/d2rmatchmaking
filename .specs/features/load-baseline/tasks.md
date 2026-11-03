# Load Baseline Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Project rules for every task of this feature:

- Run each task's gate as its own Bash call, with nothing before or after it:
  `node scripts/attempt.mjs run --feature load-baseline --step T<n> -- "<gate command>"`.
- Tests are named exactly as written in `## Checks`; the checks select them with `--test-name-pattern`. A test named otherwise leaves its check with `no test ran`.
- All code of this feature lives in `scripts/load/` (modules in `scripts/load/lib/`, containers in `scripts/load/containers/`, k6 in `scripts/load/k6/`, images in `scripts/load/docker/`), unit tests in `scripts/test/load/<module>.test.mjs`, the static test in `scripts/test/load-scripts.test.mjs`, smoke and full-run checks in `scripts/load/check/*.check.mjs` (not `*.test.mjs`, so `pnpm test:harness` never runs them). Zero dependencies: only `node:*` modules and global `fetch`. ESM, `.mjs`, no `any`-style shortcuts, `no-console` is off for these scripts.
- Pure rules take plain data and return plain data (no `Date.now()`, no `process.env`, no `fs`, no `child_process`); the impure edge is `run.mjs` and the container scripts. A rule that only the assembled run can observe is extracted into a pure function and unit-tested (ADR 026).
- `.claude/hooks/**`, `.claude/settings.json`, `docs/adr/**`, `apps/**` and every harness file (`scripts/lib/**`, `.dependency-cruiser.cjs`, `eslint.config.mjs`, `*.config.*`, `.github/workflows/**`) are **not edited** by any task. A task that needs one records it in `decisions.md` and reports. `.quality-baseline.json` is edited only by `pnpm quality:ratchet --context phase --update` (T33).
- No test, scenario or sensor is weakened, skipped or focused. The existing `# not-scenario` lines of `acceptance.feature` are not changed; `pnpm test:acceptance` is red for this feature from the spec commit until T30 defines the steps (`missingSteps: 'fail-on-gen'`), as in observability-e2e; no earlier task runs it.
- Docker tasks (T1, T32, T33) need the Docker daemon. Images and builds are pinned by digest and commit as design.md says; T1 records the versions it pins in `## Handoff`. **T1 is a spike with a gate.** If k6 with the SSE extension cannot hold two streams, send heartbeats from another scenario and post inside an event handler, T1 applies the design's fallback (reopen the stream each iteration) and records it; if that also fails, T1 stops and the orchestrator escalates (Node generator = a spec and tooling decision for the maintainer). Never switch tools on your own.
- Secrets: none. No cookie, token, password or key is written to a log, the summary, a command line or the repository; the redactor and the tests of T9, T26 and T27 pin it. Nothing is pushed, and no `docker push` or `docker login` appears anywhere.
- Run the repo's TypeScript-free scripts with Node 26 from the repository root of the worktree.

---

**Design**: `.specs/features/load-baseline/design.md`
**Status**: Approved
**Approved**: 2026-11-03 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, rules 1 to 4, 6, 7, 10 and 12), `docs/engineering/testing.md`, `docs/adr/026-mutation-unit-tests-only.md`, `docs/adr/023-bdd-acceptance.md`, `scripts/test/*.test.mjs` (style), `package.json` scripts.

| Code Layer                                         | Required Test Type                  | Coverage Expectation                                                                                   | Location Pattern                                               | Run Command                                      |
| -------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| Pure rules (`scripts/load/lib/*.mjs`)              | unit (`node:test`)                  | All branches; every boundary the spec names (2000/2001 ms, 0.01, 0.10, 70 000); 1:1 to the checks      | `scripts/test/load/<module>.test.mjs`                          | `node --test "scripts/test/load/*.test.mjs"`     |
| Container scripts (`meter.mjs`, `sink.mjs`)        | unit (in-process servers on port 0) | Window counting, discarding bodies, bearer and `Host` checks, no logging of secrets                    | `scripts/test/load/meter.test.mjs`, `sink.test.mjs`            | same                                             |
| Orchestration (`orchestrate.mjs`, `provision.mjs`) | unit with fake ports                | Sequence, stop rule, cleanup on each exit path, summary writer, redaction                              | `scripts/test/load/orchestrate.test.mjs`, `provision.test.mjs` | same                                             |
| k6 script and images (`journey.mjs`, Dockerfiles)  | static test + Docker run            | Imports `journey-state.mjs`, no `console.log`, digest pins; behaviour proved by T1 and the smoke run   | `scripts/test/load-scripts.test.mjs`, `scripts/load/check/`    | `node --test scripts/test/load-scripts.test.mjs` |
| Entry points (`run.mjs`, `publish.mjs`)            | acceptance (playwright-bdd)         | `@LB-16`, `@LB-17`, `@LB-18` scenarios as written, black-box with a `docker` shim and a temporary root | `tests/acceptance/steps/load-baseline.steps.ts`                | `bddgen` and `playwright test --grep`            |
| Root `package.json` scripts, docs, `.dockerignore` | static test                         | The three scripts exist; none in `check`, `test` or a workflow; entries of `.dockerignore`             | `scripts/test/load-scripts.test.mjs`                           | `node --test scripts/test/load-scripts.test.mjs` |
| The assembled run (Docker)                         | smoke and full run                  | Smoke: LB-01, 02, 03, 05, 09, 19; full: LB-10 to LB-15, LB-21, LB-22 and the success criteria          | `scripts/load/check/*.check.mjs`                               | `pnpm test:load:smoke`, `pnpm test:load`         |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                                | Command                                                                                                                                                                         |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick      | Pure rule and orchestration tasks          | `node --test "scripts/test/load/*.test.mjs" && pnpm exec eslint --max-warnings 0 scripts/load scripts/test/load && pnpm exec prettier --check scripts/load scripts/test/load`   |
| Static     | Tasks with images, scripts or root scripts | `node --test "scripts/test/load/*.test.mjs" scripts/test/load-scripts.test.mjs && pnpm exec eslint --max-warnings 0 scripts && pnpm exec prettier --check scripts package.json` |
| Docker     | T1 (the spike)                             | `node scripts/load/spike.mjs`                                                                                                                                                   |
| Acceptance | T30 and the closing runs                   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@LB-16\|@LB-17\|@LB-18"`         |
| Smoke      | T32                                        | `pnpm test:load:smoke && node --test scripts/load/check/smoke-summary.check.mjs`                                                                                                |
| Full run   | T33                                        | `pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`                                                                                                       |
| Build      | End of a phase                             | `pnpm build && pnpm typecheck && pnpm lint && pnpm arch && pnpm format:check && pnpm test:harness`                                                                              |

---

## Execution Plan

Phases run in order; tasks within a phase run in order. Batches (whole phases): 1 = Phase 1 (the spike alone, so an escalation comes before any other work), 2 = Phase 2, 3 = Phases 3 and 4, 4 = Phases 5 and 6, 5 = Phases 7 and 8, 6 = Phase 9 (the Docker runs).

### Phase 1: Spike

```
T1
```

### Phase 2: Measuring rules

```
T2 → T3 → T4 → T5 → T6 → T7 → T8
```

### Phase 3: Results

```
T9 → T10 → T11
```

### Phase 4: Guards and specs

```
T12 → T13 → T14 → T15 → T16 → T17
```

### Phase 5: Run model

```
T18 → T19 → T20
```

### Phase 6: Containers

```
T21 → T22 → T23
```

### Phase 7: k6 and the sequence

```
T24 → T25 → T26 → T27
```

### Phase 8: Commands, acceptance and docs

```
T28 → T29 → T30 → T31
```

### Phase 9: Runs

```
T32 → T33
```

---

## Task Breakdown

### Phase 1: Spike

### T1: Spike the k6 image and the stream roles

**What**: A pinned k6 image with the SSE extension, and a spike script that proves the roles of design.md § k6 journey against a tiny local SSE server.
**Where**: `scripts/load/docker/k6.Dockerfile` (the spike script `scripts/load/spike.mjs` and the fixture server `scripts/load/spike-server.mjs` are part of the same deliverable)
**Depends on**: None
**Reuses**: `phymbert/xk6-sse` README and design doc, `tests/acceptance/support/sse.ts` (frame shape)
**Requirement**: LB-01, LB-03, LB-05

**Done when**:

- [x] `k6.Dockerfile` is a multi-stage build (golang builder, k6 base) with `FROM` lines pinned by `@sha256:` digest, `xk6` and `xk6-sse` pinned to commit SHAs, `GOFLAGS=-mod=readonly`; it never uses runtime auto-provisioning
- [x] The spike script builds the image, starts the fixture server (SSE endpoint with `id/event/data` frames and `: ka` comments, a POST endpoint, `Set-Cookie` with a `Secure` `__Host-` cookie) on a throwaway network, and runs one short k6 script that: holds a site stream and an agent stream in two scenarios, posts a request inside an `event` handler, sends heartbeats from a third `constant-arrival-rate` scenario, sends an explicit `Cookie` header, and tags metrics by elapsed time since its own start
- [x] The spike reports, in its output and in `## Handoff`: the pinned versions and commits, whether `data_received` counts SSE bytes, whether a stream can be held for the whole step, whether `.mjs` imports (`journey-state.mjs`) work, and the fallback used if any
- [x] The spike cleans up its containers and network on every exit path
- [x] Gate passes: `node scripts/load/spike.mjs`

**Tests**: integration
**Gate**: Docker

---

### Phase 2: Measuring rules

### T2: Profile rule

**What**: The step table and window offsets for the full and smoke profiles.
**Where**: `scripts/load/lib/profile.mjs` (with `scripts/test/load/profile.test.mjs`)
**Depends on**: T1
**Reuses**: design.md § Pure rules
**Requirement**: LB-07, LB-09

**Done when**:

- [x] `profileFor('full')` returns steps 25, 50, 100, 150, 200, 300, 400, each with ramp 20 s, hold 120 s, a measuring window of the last 90 s and `windowOffsets` (start 30 s into the hold, end 120 s) in seconds from the start of k6; `profileFor('smoke')` returns one step of 5 players holding 30 s and `profile: 'smoke'`
- [x] `nextStep(profile, results)` returns the next step, or `null` after a failed step or after the last one
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T3: Error ratio rule

**What**: The error ratio formula of one step.
**Where**: `scripts/load/lib/error-ratio.mjs` (with `scripts/test/load/error-ratio.test.mjs`)
**Depends on**: T2
**Reuses**: spec Assumptions "What an error is, and the ratio"
**Requirement**: LB-08

**Done when**:

- [x] `errorRatio({ errors, requests, iterations })` returns errors over requests plus iterations, and 0 when the divisor is 0; negative or non-integer input throws
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T4: Percentile rule

**What**: The nearest-rank p95 over the windowed latency samples.
**Where**: `scripts/load/lib/percentile.mjs` (with `scripts/test/load/percentile.test.mjs`)
**Depends on**: T3
**Reuses**: none
**Requirement**: LB-06

**Done when**:

- [x] `p95(samples)` returns the nearest-rank 95th percentile (the value at rank `ceil(0.95 × n)` of the sorted samples), `null` for no samples; the input is not mutated
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T5: Container health rule

**What**: Whether the API container survived a step, and its peaks.
**Where**: `scripts/load/lib/container-health.mjs` (with `scripts/test/load/container-health.test.mjs`)
**Depends on**: T4
**Reuses**: `docker inspect` field names (`State.Running`, `State.OOMKilled`, `RestartCount`, `State.StartedAt`)
**Requirement**: LB-08

**Done when**:

- [x] `containerOk(before, after)` is false when the container is not running, was OOM-killed, has a higher restart count or a different start time; true otherwise
- [x] `peakOf(samples)` returns the highest CPU percent and memory bytes from `docker stats` samples (the `--format json` shape), 0 for no samples
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T6: Step verdict rule

**What**: The verdict of one step with the first failed rule.
**Where**: `scripts/load/lib/step-verdict.mjs` (with `scripts/test/load/step-verdict.test.mjs`)
**Depends on**: T5
**Reuses**: `error-ratio.mjs`, `percentile.mjs`, `container-health.mjs`
**Requirement**: LB-08, LB-11

**Done when**:

- [x] `verdictOf({ containerOk, errorRatio, p95Ms })` returns `{ passed, failedRule }`; p95 2000 passes and 2001 fails; ratio 0.0099 passes and 0.01 fails; a `null` p95 (no samples) fails `latency`
- [x] When several rules fail the first of `container`, `errors`, `latency` is named (AD-111)
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T7: Bytes rule

**What**: Bytes per player-hour.
**Where**: `scripts/load/lib/bytes.mjs` (with `scripts/test/load/bytes.test.mjs`)
**Depends on**: T6
**Reuses**: spec Assumptions "Bytes per player-hour"
**Requirement**: LB-14, LB-15

**Done when**:

- [x] `bytesPerPlayerHour(bytes, players, windowSeconds)` returns `bytes / players / (windowSeconds / 3600)`; a zero player or window count throws
- [x] `withinEgressBudget(bytesPerHour)` is true at 70 000 and false at 70 001 (`EGRESS_BYTES_PER_PLAYER_HOUR` exported)
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T8: Telemetry share rule

**What**: The telemetry numbers and their budget check.
**Where**: `scripts/load/lib/telemetry-share.mjs` (with `scripts/test/load/telemetry-share.test.mjs`)
**Depends on**: T7
**Reuses**: AD-097, spec Assumptions "Telemetry share"
**Requirement**: LB-21, LB-22

**Done when**:

- [x] `telemetryNumbers(bytesInWindow, players, windowSeconds)` returns `telemetryBytesPerPlayerHour`, `telemetryMonthlyBytes` (that figure × 100 players × 720 hours), `relayAllowanceMonthlyBytes` (16 MiB × 30) and `telemetryShareOfBudget` (monthly bytes over 5 GiB)
- [x] `telemetryFails(share)` is false at exactly 0.10 and true above it
- [x] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### Phase 3: Results

### T9: Summary builder

**What**: The summary of a run from its step results.
**Where**: `scripts/load/lib/summary.mjs` (with `scripts/test/load/summary.test.mjs`)
**Depends on**: T8
**Reuses**: the Data Models of design.md; `step-verdict.mjs`, `bytes.mjs`, `telemetry-share.mjs`
**Requirement**: LB-10, LB-11, LB-13, LB-15

**Done when**:

- [ ] `buildSummary(...)` returns every field of design.md's `Summary` under exactly those names: `maxConcurrentPlayers` is the highest passing step with every earlier step passing (0 when the first fails), `p95StateLatencyMs`, `bytesPerPlayerHour` and the telemetry fields come from the 100-player step and are `null` when it never ran, `maxConcurrentRooms` is the rooms of the highest passing step, `ceilingReached` is true when the 400 step passes, `passed`, `failure` (`{ step, rule }`, `telemetry` after a pass when the share fails), `error` for a tool failure (AD-115)
- [ ] `exitCodeOf(summary)` is non-zero when the 100-player step did not pass, when `failure.rule` is `telemetry`, or when `error` is set; zero when a later step fails after the 100 step passed
- [ ] The output and the `StepResult` shape contain no `cookie`, `token`, `Bearer` or password text, pinned by a test over a fixture with such strings in the inputs
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T10: Summary writer

**What**: Write the summary whole or not at all.
**Where**: `scripts/load/lib/write-summary.mjs` (with `scripts/test/load/write-summary.test.mjs`)
**Depends on**: T9
**Reuses**: none
**Requirement**: LB-12

**Done when**:

- [ ] `writeSummary(fs, dir, summary)` writes a temp file in `dir` then renames it onto `summary.json` (`smoke-summary.json` when `summary.profile` is `smoke`, and never `summary.json` for smoke), with a fake `fs` that can fail on write or rename; on failure no partial target exists
- [ ] A summary of a failed run is written the same way
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T11: Publish rule

**What**: Decide whether a summary may be published and render the document from a whitelist.
**Where**: `scripts/load/lib/publish.mjs` (with `scripts/test/load/publish.test.mjs`)
**Depends on**: T10
**Reuses**: `docs/engineering/testing.md` style for the document
**Requirement**: LB-16

**Done when**:

- [ ] `publishPlan(summary)` refuses (with a reason) a missing summary, a smoke profile and `passed: false`; for a full, passed summary it returns the text of `docs/engineering/load-baseline.md`: the numbers, the limits, the date and the commit, built only from whitelisted fields (no run id, host path, token or error text)
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### Phase 4: Guards and specs

### T12: Target and Docker guards

**What**: Refuse any target or Docker host the run did not start.
**Where**: `scripts/load/lib/target-guard.mjs` (with `scripts/test/load/target-guard.test.mjs`)
**Depends on**: T11
**Reuses**: spec LB-17, AD-117
**Requirement**: LB-17

**Done when**:

- [ ] `guardTarget(env)` returns a refusal naming `LOAD_TARGET` or `DATABASE_URL` when either is non-empty (a loopback value too) and `null` when both are unset or empty
- [ ] `guardDocker(env)` refuses a `DOCKER_HOST` that is not a local unix socket, a `DOCKER_CONTEXT` other than empty or `default`, and any set `OTEL_*` variable, naming the variable
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T13: Docker preflight classification

**What**: Name Docker or the image in a failure.
**Where**: `scripts/load/lib/preflight.mjs` (with `scripts/test/load/preflight.test.mjs`)
**Depends on**: T12
**Reuses**: `docker` CLI error texts (`command not found`/`ENOENT`, `Cannot connect to the Docker daemon`, `pull access denied`, `manifest unknown`, build failures)
**Requirement**: LB-18

**Done when**:

- [ ] `classifyDockerFailure(error)` returns `{ kind: 'docker-missing' | 'docker-down' | 'image', message }`; the message of the first two names "Docker", the third names "the image" and the image reference
- [ ] An unknown error is classified `docker-down` with the original text included (redacted)
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T14: Players

**What**: Unique player names and client addresses.
**Where**: `scripts/load/lib/players.mjs` (with `scripts/test/load/players.test.mjs`)
**Depends on**: T13
**Reuses**: the test-login name pattern `^[A-Za-z0-9-]{2,16}$` (`identity/domain/player-name.ts`)
**Requirement**: LB-03, LB-04

**Done when**:

- [ ] `playerFor(runId, index)` returns a name of 2 to 16 letters and digits that is unique per run id and index (case-insensitively), and an address in `10.0.0.0/8` that is distinct per index up to 400
- [ ] `runIdFrom(random)` returns 8 characters from `a-z0-9`
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T15: Provisioning requests

**What**: The pure request builders of the provisioner.
**Where**: `scripts/load/lib/provision-requests.mjs` (with `scripts/test/load/provision-requests.test.mjs`)
**Depends on**: T14
**Reuses**: design.md § Provisioner; wire shapes of `tests/acceptance/support/agent-client.ts`
**Requirement**: LB-03

**Done when**:

- [ ] Builders for `POST /v1/auth/test-login`, `/v1/agents/pairing-codes`, `/v1/agents/pair` and `/v1/agents/pairing-codes/claim` return `{ url, init }` with the headers each route needs (`Origin` and `Content-Type` on the three same-origin routes, `X-Agent-Version` on the agent routes, `X-Forwarded-For` per player, the cookie on `pair`, no `Authorization` on site calls)
- [ ] Every URL built has the host `127.0.0.1`; a base with another host throws
- [ ] `cookieFrom(setCookie)` returns the `__Host-d2rmm_session` pair; `tokenFrom(body)` the `d2rmm_a_` token
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T16: Container specifications

**What**: The `docker` argument arrays of the run.
**Where**: `scripts/load/lib/container-spec.mjs` (with `scripts/test/load/container-spec.test.mjs`)
**Depends on**: T15
**Reuses**: design.md § Pure rules and § Images and TLS; `render.yaml` env names; `apps/api/src/main/config.ts` variable names
**Requirement**: LB-01, LB-02

**Done when**:

- [ ] Builders return argument arrays (never strings) for the network, Postgres, the sink (owner of the API's network namespace), the API (`--network container:<sink>`, `--cpus` default 0.5, `--memory` default 512m, from `LOAD_CPUS` and `LOAD_MEMORY`), the meter, the migration and k6 (`--memory` from `LOAD_K6_MEMORY`, default `1500m`), each labelled `d2rmm-load=<runId>` and named `d2rmm-load-<runId>-<role>`
- [ ] The API environment is built from an allow-list only: `D2RMM_ENV=staging`, `ENABLE_STAGING_ENDPOINTS=true`, `SITE_ORIGIN`, `PORT`, `DATABASE_URL` (`sslmode=verify-full`), `NODE_EXTRA_CA_CERTS`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`; never `D2RMM_ACCEPTANCE`, never a spread of the process environment; the staging variables appear on no other container
- [ ] The Postgres command makes a throwaway CA and server certificate inside the container, deletes the CA key, sets the key to `postgres` ownership and mode 0600, and starts `-c ssl=on`; the password comes from an env-file path, never `-e` with a value
- [ ] `LOAD_CPUS`, `LOAD_MEMORY` and `LOAD_K6_MEMORY` pass `^\d+(\.\d+)?$` and `^\d+[mg]$`; `1500m --privileged` throws
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T17: Publish guard

**What**: Reject any container argument list that exposes more than loopback.
**Where**: `scripts/load/lib/container-spec.mjs` (modify; tests in `scripts/test/load/container-spec.test.mjs`)
**Depends on**: T16
**Reuses**: design.md § Byte meter and sink (published ports)
**Requirement**: LB-01, LB-02

**Done when**:

- [ ] `assertSafe(args)` throws on any `-p`/`--publish` not of the form `127.0.0.1:<port or empty>:<port>`, on `--network host`, `--privileged`, a mount of the Docker socket and a writable bind mount of `scripts/load`; it is applied inside every builder
- [ ] The API, Postgres and k6 builders publish nothing; the meter publishes `8080` and `9100`, the sink `9101`, on `127.0.0.1` only
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### Phase 5: Run model

### T18: Cleanup plan

**What**: What to remove on every exit path.
**Where**: `scripts/load/lib/cleanup-plan.mjs` (with `scripts/test/load/cleanup-plan.test.mjs`)
**Depends on**: T17
**Reuses**: design.md § Orchestrator (cleanup, sweep)
**Requirement**: LB-19

**Done when**:

- [ ] `cleanupPlan(created)` lists every created container (in reverse start order), the network and the work directory; with nothing created it returns an empty plan; names not matching `^d2rmm-load-[a-z0-9]{8}-` are dropped
- [ ] `sweepPlan(found)` keeps only resources labelled `d2rmm-load` whose names match `^d2rmm-load-[a-z0-9]{8}$` or `^d2rmm-load-[a-z0-9]{8}-`, and refuses symlinks, a different uid or a mode other than 0700 for directories
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T19: Window counter

**What**: The byte counter of a measuring window.
**Where**: `scripts/load/lib/window-counter.mjs` (with `scripts/test/load/window-counter.test.mjs`)
**Depends on**: T18
**Reuses**: none
**Requirement**: LB-14, LB-21

**Done when**:

- [ ] `createWindowCounter(now)` returns `start()`, `add(n)` and `stop()`; `stop()` returns `{ bytes, seconds }`; bytes added before `start` or after `stop` are ignored; a second `start` restarts the window; `stop` without `start` returns `{ bytes: 0, seconds: 0 }`
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T20: Journey state machine

**What**: The iteration's states, errors and the 5 s timeout, runnable under k6.
**Where**: `scripts/load/lib/journey-state.mjs` (with `scripts/test/load/journey-state.test.mjs`)
**Depends on**: T19
**Reuses**: design.md § Pure rules (`journey-state.mjs`); spec Edge Cases
**Requirement**: LB-04, LB-05, LB-08

**Done when**:

- [ ] A pure ES module with no Node import: `start()`, `onAssigned(state, frame, nowMs)`, `onObservationSent(state, nowMs)`, `onCreated(state, nowMs)`, `onTick(state, nowMs)` returning the next state, the latency (created minus observation) and the error count of the iteration; an iteration without a `created` frame 5 000 ms after the observation is `timed-out` with exactly one error; a `created` frame at 4 999 ms is a latency, at 5 001 ms a timeout
- [ ] `isError(status)` is true for every non-2xx status, a `429` included, and false for 200, 202 and 204
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### Phase 6: Containers

### T21: Byte meter

**What**: The TCP meter in front of the API.
**Where**: `scripts/load/containers/meter.mjs` (with `scripts/test/load/meter.test.mjs`)
**Depends on**: T20
**Reuses**: `window-counter.mjs`; `node:net`, `node:http`
**Requirement**: LB-14

**Done when**:

- [ ] `startMeter({ listen, upstream, control, token })` pipes TCP between players and the API, counts bytes sent **from the API to the players** inside a window, discards them after counting and writes nothing to a log or disk; the control endpoints `POST /window/start`, `POST /window/stop` (returns `{ bytes, seconds }`) and `GET /stats` need the per-run bearer and a `Host` header of `127.0.0.1:<port>`, else 401 or 421
- [ ] The container entry reads its settings from arguments and the token from a file, never from a command-line value
- [ ] Tests named as in `## Checks` pass, using in-process servers on port 0: quick gate

**Tests**: unit
**Gate**: Quick

---

### T22: Telemetry sink

**What**: The OTLP byte sink.
**Where**: `scripts/load/containers/sink.mjs` (with `scripts/test/load/sink.test.mjs`)
**Depends on**: T21
**Reuses**: `window-counter.mjs`; `apps/api/test/support/fake-telemetry-backend.ts` (reply shape)
**Requirement**: LB-21

**Done when**:

- [ ] `startSink({ listen, control, token })` answers `POST /v1/traces`, `/v1/metrics`, `/v1/logs` with `200 {}`, counts the bytes it reads on the wire (request line, headers and body) inside a window, discards the body and logs nothing; control endpoints as the meter's (bearer and `Host` checks)
- [ ] Tests named as in `## Checks` pass: quick gate

**Tests**: unit
**Gate**: Quick

---

### T23: API image and `.dockerignore`

**What**: The API image that mirrors Render, and a deny-by-default `.dockerignore`.
**Where**: `scripts/load/docker/api.Dockerfile` (the repo-root `.dockerignore` is part of the same deliverable)
**Depends on**: T22
**Reuses**: `render.yaml` build and start commands
**Requirement**: LB-01, LB-02

**Done when**:

- [ ] The Dockerfile uses `node:26-bookworm-slim` pinned by digest, runs `corepack enable && pnpm install --frozen-lockfile --ignore-scripts`, and starts `node --import ./apps/api/src/main/instrument.ts apps/api/src/main/render.ts`; no `COPY` of a certificate or key, no build argument, no `ENV` with a secret
- [ ] `.dockerignore` starts with `*`, re-includes only what the install and the API need (`apps/api`, `packages`, the root manifests, the lockfile and workspace file), and excludes the environment-file patterns, `**/*.pem`, `**/*.key` and `**/node_modules` again
- [ ] A static check in the static test of T28 reads both files; here: `docker build` is not run (T32 builds it); the gate checks the files with the static test
- [ ] Gate passes: `node --test scripts/test/load-scripts.test.mjs`

**Tests**: unit (static)
**Gate**: Static

---

### Phase 7: k6 and the sequence

### T24: The k6 journey script

**What**: The k6 script of one step.
**Where**: `scripts/load/k6/journey.mjs`
**Depends on**: T23
**Reuses**: `journey-state.mjs` (imported), design.md § k6 journey; T1's findings in `## Handoff`; wire shapes of `tests/acceptance/support/agent-client.ts` and `sse.ts`
**Requirement**: LB-03, LB-04, LB-05, LB-06

**Done when**:

- [ ] Reads `in/plan.json` with `open` (`/* global open */`), builds the `site`, `agent`, `heartbeat` and `control` scenarios (or T1's recorded fallback) for the plan's players and offsets, imports `./journey-state.mjs`, uses explicit `Cookie`, `Authorization`, `X-Agent-Version`, `Origin` (on `match-formed`) and per-player `X-Forwarded-For` headers, sends no `traceparent`, uses no `console.log`
- [ ] The control scenario calls the meter's and the sink's `window/start` and `window/stop` at the plan's offsets with the bearer and records their answers; latency samples, errors, requests, iterations and `agentAssignedFrames` are tagged with the `window` tag from k6's own clock; `handleSummary` writes `out/step.json` with `latencySamplesMs`, `errors`, `requests`, `iterations`, `agentAssignedFrames`, `meterBytes`, `sinkBytes`, `windowSeconds` and nothing with a token or cookie
- [ ] A static check in the static test of T28 pins the import and the absence of `console.log` and `traceparent`; `node --check scripts/load/k6/journey.mjs` passes; the behaviour is proved by T32
- [ ] Gate passes: `node --test scripts/test/load-scripts.test.mjs`

**Tests**: unit (static)
**Gate**: Static

---

### T25: Provisioner

**What**: Provision the players a step adds, over HTTP.
**Where**: `scripts/load/provision.mjs` (with `scripts/test/load/provision.test.mjs`)
**Depends on**: T24
**Reuses**: `provision-requests.mjs`, `players.mjs`; global `fetch`
**Requirement**: LB-03, LB-04

**Done when**:

- [ ] `provision({ players, base, origin, version, fetch })` signs in, requests a pairing code, pairs and claims (polling `202 pending` until `200`) for at most 20 players at a time, returns each player's `cookie` and `token`, and throws (redacted) on any non-success; it never logs a cookie or a token
- [ ] Tests named as in `## Checks` pass with a fake `fetch`: quick gate

**Tests**: unit
**Gate**: Quick

---

### T26: Orchestration sequence

**What**: The sequence of a run over injected ports.
**Where**: `scripts/load/orchestrate.mjs` (with `scripts/test/load/orchestrate.test.mjs`)
**Depends on**: T25
**Reuses**: every pure module; design.md § Orchestrator, § Work directory and credentials
**Requirement**: LB-07, LB-08, LB-10, LB-11, LB-12, LB-19

**Done when**:

- [ ] `runLoad({ profile, env, docker, http, clock, fs })` runs the guards and the preflight, sweeps stale resources, builds images, starts the network, Postgres (TLS), the sink, the API, the meter, migrates, then runs each step (provision the new players, write `in/plan.json` at mode 0600, run k6, read `out/step.json`, read the meters' totals, `docker inspect` and stats, the constant `psql` query for rooms), applies `verdictOf`, stops after the first failed step or the last, builds and writes the summary, and returns `{ summary, exitCode }`
- [ ] `cleanup()` is idempotent, runs from `finally`, ignores a repeated call while running, tries every removal even if one throws, and leaves the exit code non-zero if anything stayed; a tool failure yields `error` in the summary and still cleans up
- [ ] The redactor masks cookies, tokens, `Bearer` values, passwords and URL user-info in every log line and in every `inspect` and `stats` text; no secret appears in any docker argument (checked against the fake `docker` port)
- [ ] Tests named as in `## Checks` pass with fake ports: quick gate

**Tests**: unit
**Gate**: Quick

---

### T27: Entry point and adapters

**What**: The command and its real adapters.
**Where**: `scripts/load/run.mjs`
**Depends on**: T26
**Reuses**: `orchestrate.mjs`; `node:child_process`, `node:fs`, `node:os`
**Requirement**: LB-17, LB-18, LB-19

**Done when**:

- [ ] `run.mjs` reads `LOAD_PROFILE` (`full` or `smoke`), builds the `Docker` port over `spawn` with an **argument array and `shell: false`**, a `mkdtemp` work directory (mode 0700) under `os.tmpdir()`, takes a lock directory with the pid, registers handlers for `uncaughtException`, `unhandledRejection`, `SIGINT`, `SIGTERM` and `SIGHUP` that call the same cleanup, and exits with the summary's exit code (2 for a refusal)
- [ ] A refusal (a target or Docker variable, Docker missing or down) prints the message and exits 2 before any container exists; `node scripts/load/run.mjs` with `LOAD_TARGET` set exits 2 naming `LOAD_TARGET`
- [ ] Gate passes: `node --test "scripts/test/load/*.test.mjs" scripts/test/load-scripts.test.mjs && pnpm exec eslint --max-warnings 0 scripts && pnpm exec prettier --check scripts`

**Tests**: unit (static)
**Gate**: Static

---

### Phase 8: Commands, acceptance and docs

### T28: Package scripts and the static test

**What**: The three commands and the static test of the whole feature.
**Where**: `package.json` (modify; the test is `scripts/test/load-scripts.test.mjs`)
**Depends on**: T27
**Reuses**: `scripts/test/ci-workflow.test.mjs` (style); root `package.json`
**Requirement**: LB-04, LB-20

**Done when**:

- [ ] `package.json` has `test:load` (`LOAD_PROFILE=full node scripts/load/run.mjs`), `test:load:smoke` (`LOAD_PROFILE=smoke node scripts/load/run.mjs`) and `load:publish` (`node scripts/load/publish.mjs`); none is named by `check`, `test`, `test:harness`, `test:integration` or any workflow in `.github/workflows`
- [ ] The static test also pins: the pairing limiter's constants in `apps/api/src/modules/agents/domain/sliding-window.ts` (10 code requests an hour per address, 10 submissions per 5 minutes per account), every `FROM` and image reference under `scripts/load` pinned with `@sha256:`, no `docker push`, `docker login`, `--push`, `shell: true`, `exec(` or `sh -c` with interpolation under `scripts/load`, the `.dockerignore` entries, the API image's commands equal to `render.yaml`'s, `journey.mjs` importing `journey-state.mjs` and containing neither `console.log` nor `traceparent`
- [ ] Gate passes: `node --test "scripts/test/load/*.test.mjs" scripts/test/load-scripts.test.mjs && pnpm exec eslint --max-warnings 0 scripts && pnpm exec prettier --check scripts package.json`

**Tests**: unit (static)
**Gate**: Static

---

### T29: Publish command

**What**: The command that writes the published document.
**Where**: `scripts/load/publish.mjs`
**Depends on**: T28
**Reuses**: `lib/publish.mjs`, `node:fs`
**Requirement**: LB-16

**Done when**:

- [ ] `node scripts/load/publish.mjs [--root <dir>]` reads `<root>/reports/load/summary.json` (default root: the repository), applies `publishPlan`, writes `<root>/docs/engineering/load-baseline.md` only when allowed, and exits 1 with the reason and no file written when the summary is missing, smoke or not passed
- [ ] Gate passes: `node --test "scripts/test/load/*.test.mjs" scripts/test/load-scripts.test.mjs && pnpm exec eslint --max-warnings 0 scripts && pnpm exec prettier --check scripts`

**Tests**: unit (static)
**Gate**: Static

---

### T30: Acceptance steps

**What**: The step definitions of the three scenarios.
**Where**: `tests/acceptance/steps/load-baseline.steps.ts`
**Depends on**: T29
**Reuses**: `tests/acceptance/steps/harness-foundation.steps.ts` (spawn a repo command and assert), `fixtures.ts`
**Requirement**: LB-16, LB-17, LB-18

**Done when**:

- [ ] Steps for every line of the `@LB-16`, `@LB-17` and `@LB-18` scenarios exactly as written (the `.feature` is not edited), black-box: they spawn `node scripts/load/run.mjs` and `node scripts/load/publish.mjs` with a temporary root and a `docker` shim on `PATH` (not installed, daemon down, pull fails), and assert exit codes, messages and that no file or container was created; no import from `apps/*`
- [ ] `bddgen` is clean for the whole suite and the three scenarios pass
- [ ] Gate passes: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@LB-16\|@LB-17\|@LB-18"`

**Tests**: acceptance
**Gate**: Acceptance

---

### T31: Testing docs

**What**: Name the real location of the load code in the testing doc and describe the run.
**Where**: `docs/engineering/testing.md` (modify)
**Depends on**: T30
**Reuses**: AD-110
**Requirement**: LB-20

**Done when**:

- [ ] The load row names `scripts/load` instead of `tests/load`, the three commands, that the run needs Docker, is on demand and at the end of a phase, and is never part of `pnpm check` or a pull-request workflow; `pnpm format:check` passes
- [ ] Gate passes: `pnpm exec prettier --check docs/engineering/testing.md && node --test scripts/test/load-scripts.test.mjs`

**Tests**: none
**Gate**: Static

---

### Phase 9: Runs

### T32: Smoke run

**What**: Run the smoke profile for real and check its summary.
**Where**: `scripts/load/check/smoke-summary.check.mjs`
**Depends on**: T31
**Reuses**: `reports/load/smoke-summary.json`
**Requirement**: LB-01, LB-02, LB-03, LB-05, LB-09, LB-19

**Done when**:

- [ ] `pnpm test:load:smoke` exits 0 against real containers; if it fails, the worker finds the cause by reading the printed error and the container logs of the run, fixes the code (never the check), and the gate runs again within the retry budget
- [ ] The check reads `reports/load/smoke-summary.json` and asserts `profile: "smoke"`, `passed: true`, `error: null`, `steps.length: 1` with 5 players, latency samples above 0, `agentAssignedFrames` above 0, `meterBytes` above 0, `sinkBytes` above 0, the CPU and memory limits equal to the defaults, versions present, no cookie, token or password text, and that `summary.json` was not written
- [ ] After the run no container, network or `d2rmm-load-*` temp directory is left (`docker ps -a`, `docker network ls` filtered by the label, and `os.tmpdir()` listing in the check)
- [ ] Gate passes: `pnpm test:load:smoke && node --test scripts/load/check/smoke-summary.check.mjs`

**Tests**: integration
**Gate**: Smoke

---

### T33: Full run, publish and baseline

**What**: The full run of the F0 exit criterion, its published document and the first baseline values.
**Where**: `scripts/load/check/full-summary.check.mjs`
**Depends on**: T32
**Reuses**: `reports/load/summary.json`, `pnpm load:publish`, `pnpm quality:collect`, `pnpm quality:ratchet`
**Requirement**: LB-10, LB-11, LB-12, LB-13, LB-14, LB-15, LB-21, LB-22

**Done when**:

- [ ] `pnpm test:load` ends with `passed: true`; `maxConcurrentPlayers` is at least 100, `p95StateLatencyMs` at most 2000, the 100-player error ratio below 1%, `telemetryShareOfBudget` at most 0.10. If the run misses the minimum, that is a **finding**: the task stops, the summary is kept, and `## Handoff` and `decisions.md` name the step, the failed rule and the bottleneck (the API pool of 10 connections and the per-request session lookup are the first suspects); no API code is changed here
- [ ] The check reads `reports/load/summary.json` and asserts the thresholds above, the four top-level names, `maxConcurrentRooms` above 0, `bytesPerPlayerHour` and the telemetry fields present, a row per executed step, and no secret text
- [ ] `pnpm load:publish` writes `docs/engineering/load-baseline.md` from that summary; `pnpm quality:collect` reads the three load metrics; `pnpm quality:ratchet --context phase --update` records them as the first baseline values and the diff of `.quality-baseline.json` shows only the three `null` values becoming numbers
- [ ] Gate passes: `pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`

**Tests**: integration
**Gate**: Full run

**Commit**: `feat(load-baseline): first load baseline`

---

## Checks

**C1** - The full profile has the steps 25, 50, 100, 150, 200, 300 and 400, each ramping 20 s, holding 120 s with the last 90 s as its window (LB-07, AC 7)
Proof: `node --test scripts/test/load/profile.test.mjs --test-name-pattern "full profile steps"`

**C2** - After a failed step, and after the 400-player step, there is no next step (LB-07, AC 7)
Proof: `node --test scripts/test/load/profile.test.mjs --test-name-pattern "no next step after a failure or the last step"`

**C3** - The smoke profile is one step of 5 players holding 30 s, marked `smoke` (LB-09, AC 9)
Proof: `node --test scripts/test/load/profile.test.mjs --test-name-pattern "smoke profile"`

**C4** - The error ratio is errors over journey requests plus iterations, and 0 when the divisor is 0 (LB-08, AC 8)
Proof: `node --test scripts/test/load/error-ratio.test.mjs --test-name-pattern "error ratio is errors over requests plus iterations"`

**C5** - The p95 is the nearest-rank value at rank ceil(0.95 n), and null for no samples (LB-06, AC 6)
Proof: `node --test scripts/test/load/percentile.test.mjs --test-name-pattern "nearest-rank p95"`

**C6** - A step fails `container` when the API container is not running, was OOM-killed, restarted or started again (LB-08, AC 8)
Proof: `node --test scripts/test/load/container-health.test.mjs --test-name-pattern "container is not ok after a restart, an OOM kill or a stop"`

**C7** - A p95 of 2000 ms passes and 2001 ms fails `latency` (LB-08, AC 8)
Proof: `node --test scripts/test/load/step-verdict.test.mjs --test-name-pattern "p95 boundary at 2000 ms"`

**C8** - An error ratio of 0.0099 passes and 0.01 fails `errors` (LB-08, AC 8)
Proof: `node --test scripts/test/load/step-verdict.test.mjs --test-name-pattern "error ratio boundary at 1%"`

**C9** - When several rules fail, the first of `container`, `errors`, `latency` is named (LB-11, AC 2)
Proof: `node --test scripts/test/load/step-verdict.test.mjs --test-name-pattern "first failed rule order"`

**C10** - Bytes per player-hour is bytes over 100 players and the window in hours, and 70 000 is within the budget while 70 001 is not (LB-14, AC 4; LB-15, AC 5)
Proof: `node --test scripts/test/load/bytes.test.mjs --test-name-pattern "bytes per player-hour"`

**C11** - The window counter ignores bytes outside its window (LB-14, AC 4; edge: setup requests outside the window)
Proof: `node --test scripts/test/load/window-counter.test.mjs --test-name-pattern "bytes outside the window are ignored"`

**C12** - The telemetry numbers are the per-player-hour bytes, the monthly bytes at 100 players for 720 hours, the relay allowance of 16 MiB times 30, and the share of 5 GiB (LB-21, AC 1)
Proof: `node --test scripts/test/load/telemetry-share.test.mjs --test-name-pattern "telemetry numbers"`

**C13** - A telemetry share of exactly 0.10 passes and just above it fails (LB-22, AC 2)
Proof: `node --test scripts/test/load/telemetry-share.test.mjs --test-name-pattern "share boundary at 0.10"`

**C14** - `maxConcurrentPlayers` is the highest passing step with every earlier step passing, and 0 when the first step fails (LB-10, AC 1)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "maxConcurrentPlayers"`

**C15** - A failed 100-player step writes `passed: false`, a `failure` naming the step and the rule, and a non-zero exit code; a telemetry failure after a pass does the same (LB-11, AC 2; LB-22, AC 2)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "failure names the step and the rule"`

**C16** - The summary carries `maxConcurrentPlayers`, `maxConcurrentRooms`, `bytesPerPlayerHour` and `p95StateLatencyMs` under exactly those names, the last two read at the 100-player step and the rooms at the end of the highest passing step (LB-13, AC 4)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "top-level numbers"`

**C17** - The summary also holds `passed`, `profile`, the limits, the versions, the commit, the times, `withinEgressBudget` and one row per step with its peaks (LB-15, AC 5)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "summary fields"`

**C18** - A 100-player step that never ran leaves its numbers `null`; the 400-player pass says `ceilingReached: true` with exit 0; a later failure after a passing 100 step exits 0 with the last passing step (LB-10, AC 1; LB-11 edge cases)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "unmeasured numbers, ceiling and a later failure"`

**C19** - No cookie, token, `Bearer` or password text reaches the summary (LB-15, AC 5; AGENTS.md rule 6)
Proof: `node --test scripts/test/load/summary.test.mjs --test-name-pattern "no secret text in the summary"`

**C20** - The summary file is whole or absent, also for a failed run, and the smoke run never writes `summary.json` (LB-12, AC 3)
Proof: `node --test scripts/test/load/write-summary.test.mjs --test-name-pattern "whole or absent"`

**C21** - A summary that is missing, from the smoke profile or not passed is refused and nothing is written (LB-16, AC 6)
Proof: `node --test scripts/test/load/publish.test.mjs --test-name-pattern "refuses a missing, smoke or failed summary"`

**C22** - A full, passed summary publishes the numbers, the limits, the date and the commit from a whitelist of fields (LB-16, AC 6)
Proof: `node --test scripts/test/load/publish.test.mjs --test-name-pattern "publishes a passed full summary"`

**C23** - A non-empty `LOAD_TARGET` or `DATABASE_URL`, a loopback value included, is refused naming the variable (LB-17, AC 1)
Proof: `node --test scripts/test/load/target-guard.test.mjs --test-name-pattern "refuses a non-empty target"`

**C24** - An unset or empty `LOAD_TARGET` or `DATABASE_URL` is ignored (LB-17, AC 1)
Proof: `node --test scripts/test/load/target-guard.test.mjs --test-name-pattern "ignores unset and empty"`

**C25** - A remote `DOCKER_HOST`, a non-default `DOCKER_CONTEXT` and an inherited `OTEL_*` variable are refused (LB-17, AC 1; AD-117)
Proof: `node --test scripts/test/load/target-guard.test.mjs --test-name-pattern "refuses a remote Docker host"`

**C26** - Docker not installed, the daemon down and an image failure are classified so the message names Docker or the image (LB-18, AC 2)
Proof: `node --test scripts/test/load/preflight.test.mjs --test-name-pattern "classifies Docker failures"`

**C27** - Player names are unique, 2 to 16 letters and digits, and each player has its own client address (LB-03, AC 3; LB-04, AC 4)
Proof: `node --test scripts/test/load/players.test.mjs --test-name-pattern "unique names and distinct addresses"`

**C28** - Every non-2xx answer of a journey request, a `429` included, is an error (LB-04, AC 4)
Proof: `node --test scripts/test/load/journey-state.test.mjs --test-name-pattern "a 429 is an error"`

**C29** - The provisioning requests carry the headers each route needs and only target `127.0.0.1` (LB-03, AC 3)
Proof: `node --test scripts/test/load/provision-requests.test.mjs --test-name-pattern "provisioning requests"`

**C30** - The provisioner signs in, pairs and claims for each player and never logs a cookie or a token (LB-03, AC 3)
Proof: `node --test scripts/test/load/provision.test.mjs --test-name-pattern "provisions players without logging secrets"`

**C31** - The containers get the default limits (0.5 CPU, 512m) from `LOAD_CPUS` and `LOAD_MEMORY`, and a value with extra arguments is refused (LB-01, AC 1)
Proof: `node --test scripts/test/load/container-spec.test.mjs --test-name-pattern "limits and strict values"`

**C32** - The API environment is an allow-list with the real clock, the staging endpoints, no acceptance controls, the loopback exporter and the CA path, and the staging variables are on no other container (LB-02, AC 2)
Proof: `node --test scripts/test/load/container-spec.test.mjs --test-name-pattern "API environment allow-list"`

**C33** - Postgres starts with TLS from a certificate made inside the container and a password from an env-file (LB-01, AC 1)
Proof: `node --test scripts/test/load/container-spec.test.mjs --test-name-pattern "Postgres with TLS"`

**C34** - Only `127.0.0.1` ports are published, never for the API, Postgres or k6; no host network, privileged mode or socket mount (LB-01, AC 1; LB-02, AC 2)
Proof: `node --test scripts/test/load/container-spec.test.mjs --test-name-pattern "publish guard"`

**C35** - The cleanup plan removes every container, the network and the work directory, is safe with nothing created, and the sweep only touches labelled, well-named, current-user resources (LB-19, AC 3)
Proof: `node --test scripts/test/load/cleanup-plan.test.mjs --test-name-pattern "cleanup and sweep plans"`

**C36** - An iteration without a `created` frame 5 000 ms after its observation is one error, and a frame at 4 999 ms is a latency (LB-05, AC 5; LB-08 edge case)
Proof: `node --test scripts/test/load/journey-state.test.mjs --test-name-pattern "five second timeout"`

**C37** - The meter counts bytes from the API to the players only inside its window, discards them, and its control endpoints need the bearer and a loopback `Host` (LB-14, AC 4)
Proof: `node --test scripts/test/load/meter.test.mjs --test-name-pattern "meter counts API bytes inside the window"`

**C38** - The sink answers the OTLP paths with `200 {}`, counts the wire bytes inside its window and discards them, with the same control checks (LB-21, AC 1)
Proof: `node --test scripts/test/load/sink.test.mjs --test-name-pattern "sink counts wire bytes inside the window"`

**C39** - The sequence stops at the first failed step, writes the summary, and cleans up on a pass, a failed step, a signal, an uncaught error and a failing removal (LB-07, AC 7; LB-19, AC 3)
Proof: `node --test scripts/test/load/orchestrate.test.mjs --test-name-pattern "sequence and cleanup on every exit path"`

**C40** - No secret appears in a docker argument or a log line of the sequence (LB-03; AGENTS.md rule 6)
Proof: `node --test scripts/test/load/orchestrate.test.mjs --test-name-pattern "no secret in arguments or logs"`

**C41** - The pairing limiter's constants are unchanged: 10 code requests an hour per address and 10 submissions per 5 minutes per account (LB-04, AC 4)
Proof: `node --test scripts/test/load-scripts.test.mjs --test-name-pattern "pairing limiter constants"`

**C42** - The load scripts are named by no `check`, `test` or workflow, and exist as `pnpm test:load`, `pnpm test:load:smoke` and `pnpm load:publish` (LB-20, AC 4)
Proof: `node --test scripts/test/load-scripts.test.mjs --test-name-pattern "load scripts are on demand only"`

**C43** - Every image reference is pinned by digest, nothing is pushed, no shell is used, `.dockerignore` is deny-by-default, the API image mirrors Render, and `journey.mjs` imports `journey-state.mjs` (LB-01, LB-05; security review)
Proof: `node --test scripts/test/load-scripts.test.mjs --test-name-pattern "images, shell and journey rules"`

**C44** - A target that is not the run's own container is refused before any container starts: `LOAD_TARGET` and `DATABASE_URL` (LB-17, AC 1)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@LB-17"`

**C45** - With Docker not installed, not running or unable to pull the k6 image, the run fails before any container and names Docker or the image (LB-18, AC 2)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@LB-18"`

**C46** - A summary that is missing, smoke or failed is not published and the document is not written (LB-16, AC 6)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@LB-16"`

**C47** - The smoke run starts Postgres with TLS and the limited API, plays the journey for 5 players (both streams, heartbeats, a match, the observation, `created`), records bytes at the meter and the sink, writes `smoke-summary.json` only, and leaves no container behind (LB-01, LB-02, LB-03, LB-05, LB-09, LB-19)
Proof: `pnpm test:load:smoke && node --test scripts/load/check/smoke-summary.check.mjs`

**C48** - The full run passes: 100 players or more inside 2 s p95 with fewer than 1% errors, the numbers published in `reports/load/summary.json`, the telemetry share at most 0.10 (LB-10, LB-11, LB-13, LB-14, LB-15, LB-21, LB-22; Success Criteria)
Proof: `pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** T1 spike (execute-batch-1, 2026-11-03). `node scripts/load/spike.mjs` passed on attempt 6 of the T1 unit. One counted failure: k6 rejected the `count` aggregation on a Trend threshold; fixed with `avg>=0`. The primary design holds, so no fallback was used.

- Pins: `golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414` (builder; the upstream k6 v2.3.0 Dockerfile pins the same tag at `sha256:4cb7ac97…`, so the tag has moved and the current digest is used); `grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8` (base; its binary is replaced); `node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9` (fixture server, in spike.mjs).
- Versions: k6 v2.3.0 (go1.27.1); xk6 v1.4.15 at commit `971105042f8d3aaedd9a6b3e6b46561f92910eb3`; xk6-sse v0.2.0 at commit `6f12f6a6cd8cd7e0f6d1797dc31880ad89561284` (tag object `8db3dee5…`). `k6 version` reports `k6/x/sse`.
- `data_received` counts SSE bytes: yes, framing and response headers included. Stream-only run: k6 reported 380 bytes against 114 SSE bytes the server wrote on that agent stream. The primary run total (8835) also holds the POST replies, so it does not answer the question alone.
- Stream held for the whole step: yes at 20 s. Site 20002 ms and agent 20003 ms on the server; about 20.0 s in k6. The 120 s hold of the real step was not tried.
- `.mjs` imports: yes. `spike-journey.mjs` imports `./spike-state.mjs` and the run passed.
- POST inside an `event` handler: yes. The observation POST from the `room.assigned` handler got 202, and the `created` frame came back on the same stream.
- Heartbeats from a third `constant-arrival-rate` scenario while two streams are held: yes. 41 of 41 heartbeats arrived with both streams open, and k6 saw 41 OK.
- Explicit `Cookie` header: accepted. A request without it got 401, so k6's jar does not resend the `Secure` `__Host-` cookie.
- The 0600 work files are readable by the k6 container (uid 12345) over the Docker Desktop bind mount. No 0644 fallback was needed.
- Metric tags: `window` tags from `exec.instance.currentTestRunDuration` populate. A sub-metric appears in the summary only with a threshold on it. The spike uses always-true expressions (`count>=0` on Counters, `avg>=0` on Trends, since `count` is rejected on a Trend). It did not test the design's empty arrays.
- Build notes: an `ARG K6_VERSION` is exported to RUN and collides with xk6's own flag, so the build ARG is `K6_RELEASE` and xk6 gets `--k6-version`. xk6 needs `git` in the builder.
- Cleanup: no containers, network or work directory was left after any attempt. The failure path and the success path were both exercised. The signal path was not. The image `d2rmm-load-k6:spike` stays in the local cache and was not pushed.
- Tooling: the gate hook denied a direct `pnpm exec eslint` once (denial 1 of 3). I did not retry it. ESLint on `scripts/load` ran through `attempt.mjs` under T1 and passed.
  **Dispatched:** execute-batch-1 (T1, the spike) at HEAD 556a765, 2026-11-03, `returned` (T1 committed 8cfe8e3); execute-batch-2 (T2 to T8) at HEAD 8cfe8e3, 2026-11-03
  **Walked:** none

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9

Phase 1:  T1
Phase 2:  T2 ------→ T3 ------→ T4 ------→ T5 ------→ T6 ------→ T7 ------→ T8
Phase 3:  T9 ------→ T10 -----→ T11
Phase 4:  T12 -----→ T13 -----→ T14 -----→ T15 -----→ T16 -----→ T17
Phase 5:  T18 -----→ T19 -----→ T20
Phase 6:  T21 -----→ T22 -----→ T23
Phase 7:  T24 -----→ T25 -----→ T26 -----→ T27
Phase 8:  T28 -----→ T29 -----→ T30 -----→ T31
Phase 9:  T32 -----→ T33
```

Execution is strictly sequential - there is no intra-phase parallelism.
