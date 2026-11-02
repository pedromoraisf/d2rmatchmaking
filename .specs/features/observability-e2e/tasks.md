# Observability End to End Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Project rules for every task of this feature:

- Run each task's gate as its own Bash call, with nothing before or after it:
  `node scripts/attempt.mjs run --feature observability-e2e --step T<n> -- "<gate command>"`.
- Tests are named as written below; the checks select them by name. A task whose gate needs a package or an API shape the design marks as unverified (T9, T13, T38 to T43) reads the registry or the locked sources first and records the pinned versions in `## Handoff`.
- **T13 is a spike with a gate.** If auto-instrumentation of `pg` and Fastify does not work under `node --import` with type stripping, apply the design's fallback (a Fastify `onRequest` hook with `propagation.extract` for the server span, a Kysely `log` callback for the `pg` span, a pino destination stream for logs), record it in `## Handoff` and in `decisions.md`, and continue. The tests of T13 to T16 hold either way.
- `.claude/hooks/**`, `.claude/settings.json`, `docs/adr/**` and `deny.toml` are not edited by any task. A task that needs one records it in `decisions.md` and reports. A missing licence in `cargo deny` stops T42 as a maintainer decision.
- No test is weakened, skipped or focused; the existing acceptance scenarios and the whole `pnpm test:acceptance` run stay green with the site built with telemetry on (T50 onward).
- Contract rule: T32 is the only task that changes `openapi.json`; every other task leaves `pnpm contracts:check` clean.
- Rust lives in `~/.cargo/bin`, which is not on the default shell PATH; a Rust gate runs with `PATH="$HOME/.cargo/bin:$PATH"`. Code under `#[cfg(windows)]` is checked with `node scripts/agent/win-check.mjs` (AD-071).
- New secrets: none. `.env.example` holds placeholders only.

---

**Design**: `.specs/features/observability-e2e/design.md`
**Status**: Approved
**Approved**: 2026-11-02 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, rules 1 to 4, 10 and 12), `docs/engineering/testing.md`, `docs/engineering/telemetry.md`, `docs/adr/026-mutation-unit-tests-only.md`, `.dependency-cruiser.cjs`, `vitest.config.ts` and `vitest.integration.config.ts` of the API, `.cargo/mutants.toml`.

| Code Layer                                         | Required Test Type                           | Coverage Expectation                                                                             | Location Pattern                                                  | Run Command                      |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- |
| Telemetry package (pure helpers, SDK wrappers)     | unit (Vitest)                                | All branches; every forbidden key, URL form, ratio and cap case; shared sampler vector           | `packages/telemetry/src/**/*.test.ts` (colocated)                 | Telemetry gate                   |
| API application (use cases, ports)                 | unit (Vitest, fakes)                         | All branches; `beforeLookup`, `throttled`, `RoomMetrics` with `FakeClock`; no SDK import         | `apps/api/src/modules/**/application/*.test.ts`                   | API unit gate                    |
| API platform (outbox, relay, hub, relay route)     | integration (Testcontainers) and unit        | Round trips with and without `trace_context`; every relay status; order table; closed-port run   | `apps/api/src/platform/**/*.test.ts`, `*.int.test.ts`             | API full gate                    |
| API composition (`main/`)                          | integration                                  | Both roots start with the endpoint unset; the preload exports spans, metrics and logs            | `apps/api/src/main/__tests__/*.int.test.ts`                       | API full gate                    |
| Site (`apps/web`, Pages Function)                  | unit (Vitest, jsdom/node)                    | Tracing fetcher, navigation span, switch off, proxy headers                                      | `apps/web/src/**/*.test.ts(x)`, `apps/web/functions/**/*.test.ts` | Web gate                         |
| Agent adapters (queue, client, sanitize, exporter) | unit (`cargo nextest --lib`) + mutation      | Every branch of the pure functions; unreachable relay; slow relay                                | `apps/agent/src-tauri/adapters/src/telemetry/**` (colocated)      | Rust adapters gate               |
| Agent example and guards                           | unit and harness (`node:test`)               | The example prints its lines; the feature is never default; the release workflow never builds it | `adapters/examples/headless.rs`, `scripts/test/agent-*.test.mjs`  | Rust adapters gate, Harness gate |
| Agent app crate (Windows shell)                    | unit, `#[cfg(windows)]` in CI                | Export config is `None` unless the explicit flag is set                                          | `apps/agent/src-tauri/src/**`                                     | Rust Windows gate                |
| Harness (compose, dashboard, scripts, workflows)   | harness unit (`node:test`)                   | Each rule fails on its own fixture; clean tree passes                                            | `scripts/test/*.test.mjs`                                         | Harness gate                     |
| ESLint and cruiser rules                           | unit (Vitest in `@d2rmm/config`) and harness | A fixture breaks each new rule                                                                   | `packages/config/test/rules.test.ts`, `scripts/test/`             | Config gate, Harness gate        |
| Acceptance support code and steps                  | acceptance (playwright-bdd) and unit         | Every scenario of `acceptance.feature` as written; helper unit tests                             | `tests/acceptance/**`                                             | Acceptance gate                  |
| Manifests, `render.yaml`, `compose.yaml`, JSON     | none                                         | - (covered by the harness tests above)                                                           | -                                                                 | build gate only                  |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level     | When to Use                           | Command                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry      | Tasks in `packages/telemetry`         | `pnpm --filter @d2rmm/telemetry typecheck && pnpm --filter @d2rmm/telemetry lint && pnpm --filter @d2rmm/telemetry test`                                                                                                                                                                                         |
| Config         | ESLint rule tasks                     | `pnpm --filter @d2rmm/config test`                                                                                                                                                                                                                                                                               |
| API unit       | API tasks with unit tests only        | `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`                                                                                                                                                                                                                                            |
| API full       | API tasks with integration tests      | `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:integration`                                                                                                                                                                                               |
| Web            | Site and Pages Function tasks         | `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`                                                                                                                                                                                                                                            |
| Harness        | Guards, workflows, compose, dashboard | `pnpm test:harness`                                                                                                                                                                                                                                                                                              |
| Rust adapters  | Agent adapters tasks                  | `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters` |
| Rust workspace | Tasks that touch several crates       | the same three commands with `--workspace`                                                                                                                                                                                                                                                                       |
| Rust Windows   | Tasks touching `#[cfg(windows)]` code | `node scripts/agent/win-check.mjs` (AD-071)                                                                                                                                                                                                                                                                      |
| Acceptance     | Acceptance step tasks                 | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "<scenario title>"` (T56: `pnpm test:acceptance`)                                                                                                                  |
| Build          | End of a phase with manifest changes  | `pnpm build && pnpm typecheck && pnpm lint && pnpm arch && pnpm format:check`                                                                                                                                                                                                                                    |

---

## Execution Plan

Phases run in order; tasks within a phase run in order. Batches (whole phases): 1 = Phases 1 to 2, 2 = Phases 3 to 4, 3 = Phase 5 to 6, 4 = Phase 7 (relay, T26 to T33), 5 = Phases 8 to 9 (site and agent, first half), 6 = Phase 10, 7 = Phases 11 to 12. Batches 8 and 9 are kept for the Verifier's findings.

### Phase 1: Telemetry vocabulary

```
T1 → T2 → T3 → T4 → T5 → T6
```

### Phase 2: Telemetry SDK wrappers and rules

```
T7 → T8 → T9 → T10 → T11
```

### Phase 3: API bootstrap

```
T12 → T13 → T14 → T15 → T16
```

### Phase 4: The outbox carries the trace

```
T17 → T18 → T19 → T20 → T21
```

### Phase 5: Span attributes and the room metric

```
T22 → T23 → T24 → T25
```

### Phase 6: The relay building blocks

```
T26 → T27 → T28 → T29 → T30
```

### Phase 7: The relay route

```
T31 → T32 → T33
```

### Phase 8: The site

```
T34 → T35 → T36 → T37
```

### Phase 9: The agent exporter

```
T38 → T39 → T40 → T41 → T42 → T43
```

### Phase 10: The agent example and its guards

```
T44 → T45 → T46
```

### Phase 11: Local backend and dashboard

```
T47 → T48 → T49
```

### Phase 12: Acceptance and close

```
T50 → T51 → T52 → T53 → T54 → T55 → T56
```

---

## Task Breakdown

#### Phase 1: Telemetry vocabulary

### T1: Point the telemetry package at its source and add the entries

**What**: `@d2rmm/telemetry` exports `.`, `./node` and `./web` from source files, with its dependencies installed and the lockfile committed.
**Where**: `packages/telemetry/package.json`
**Depends on**: None
**Reuses**: `packages/contracts/package.json` (source exports); `packages/telemetry/tsconfig.json`
**Requirement**: OBS-39

**Done when**:

- [x] `exports` is `{ ".": "./src/index.ts", "./node": "./src/node-sdk.ts", "./web": "./src/web-sdk.ts" }`; `src/node-sdk.ts` and `src/web-sdk.ts` exist as `export {};` stubs; the `build` script no longer matters to consumers
- [x] dependencies from the design are installed (`@opentelemetry/api`, `core`, `resources`, `sdk-trace-base`, `sdk-metrics`, `sdk-logs`, the three OTLP HTTP exporters, `semantic-conventions`, `sdk-trace-web`), versions pinned from the registry and listed in `## Handoff`; `pnpm-lock.yaml` committed
- [x] test `entries resolve to source files` in `src/package-exports.test.ts` imports the three specifiers and passes; the cruiser resolves `@d2rmm/telemetry` to `packages/telemetry/src` (`pnpm arch` clean)

**Tests**: unit
**Gate**: Telemetry

---

### T2: The attribute constants and the instrument names

**What**: `attributes.ts` holds the `d2r.*` constants and `instrument-names.ts` the metric names; both are exported from the root.
**Where**: `packages/telemetry/src/attributes.ts`
**Depends on**: T1
**Reuses**: design doc names (`d2r.room.id`, `d2r.queue.mode`, `d2r.difficulty`, `d2r.ladder`, `d2r.era`, `d2r.agent.version`)
**Requirement**: OBS-30, OBS-36

**Done when**:

- [x] `attributes.ts` exports the six standardized constants plus `d2r.stream.kind`, `d2r.room.stage`, `d2r.outbox.event_type`; `instrument-names.ts` exports `INSTRUMENT_NAMES` with the five AD-087 metric names
- [x] test `exports the standardized d2r attribute constants` and test `lists the five skeleton instruments` pass
- [x] the root `index.ts` re-exports both and imports no `@opentelemetry/sdk-*`

**Tests**: unit
**Gate**: Telemetry

---

### T3: Attribute redaction and text scrubbing

**What**: `redactAttributes` and `scrubText` are pure functions in the root entry.
**Where**: `packages/telemetry/src/redact-attributes.ts`
**Depends on**: T2
**Reuses**: design § Telemetry package (key list, URL keys)
**Requirement**: OBS-28, OBS-29

**Done when**:

- [x] forbidden keys (full key or last dot segment, case-insensitive: `authorization, cookie, set-cookie, token, code, secret, password, image, battletag`) are dropped; `http.response.status_code`, `db.statement`, `d2r.room.id` are kept; `pairing.code`, `http.request.header.authorization` and `x-token` are dropped
- [x] `url.full`, `http.url`, `http.target`, `url.query` lose `?…` and `#…`; `client.address`, `user_agent.original` and `enduser.*` are dropped
- [x] `scrubText` replaces `Bearer <token>`, the session cookie, `code=`/`token=` and JSON-shaped secrets (`"token":"…"`), and a `pg` DETAIL line with a `battletag` key
- [x] tests `strips every forbidden key and keeps the allowed ones`, `removes the query string and the fragment from url attributes and drops the client address`, `scrubs plain and json shaped secrets from text` pass

**Tests**: unit
**Gate**: Telemetry

---

### T4: Trace context helpers and the traceparent-only propagator

**What**: `traceparentOf`, `contextFromTraceparent` and `TraceparentOnlyPropagator`.
**Where**: `packages/telemetry/src/trace-context.ts`
**Depends on**: T3
**Reuses**: `@opentelemetry/core` `W3CTraceContextPropagator`
**Requirement**: OBS-05, OBS-07

**Done when**:

- [x] a round trip `traceparentOf(contextFromTraceparent(text))` returns the same value; a malformed value yields a context with no span; with no active span `traceparentOf` returns `undefined`
- [x] `TraceparentOnlyPropagator` extracts `traceparent` and ignores `tracestate` and baggage on extract and on inject
- [x] tests `round trips a traceparent`, `a malformed traceparent yields no context`, `ignores tracestate on extract` pass

**Tests**: unit
**Gate**: Telemetry

---

### T5: The sampler and its shared decision vector

**What**: `samplerFrom` with `CappedRatioSampler` (ratio plus one shared token bucket) and a vector file read by TypeScript now and by Rust in T41.
**Where**: `packages/telemetry/src/sdk/sampler.ts`
**Depends on**: T4
**Reuses**: `@opentelemetry/sdk-trace-base` `ParentBasedSampler`, `TraceIdRatioBased`
**Requirement**: OBS-43

**Done when**:

- [x] ratio from the text, `0.1` when undefined or invalid; local parents followed; all three other branches use `CappedRatioSampler` (20 sampled traces a second, burst 40, `now` injected; a token is taken only when the ratio check passes)
- [x] `packages/telemetry/test-vectors/sampler.json` holds trace ids, ratios and the expected decisions; the test reads it
- [x] tests `ratio from the variable and 0.1 when unset`, `a local child follows its parent`, `a forced sampled flag cannot exceed the cap`, `decisions match the shared vector` pass

**Tests**: unit
**Gate**: Telemetry

---

### T6: Resource attributes

**What**: `resource.ts` builds the resource every bootstrap uses and filters foreign resource attributes.
**Where**: `packages/telemetry/src/sdk/resource.ts`
**Depends on**: T5
**Reuses**: `@opentelemetry/resources`
**Requirement**: OBS-32

**Done when**:

- [x] `createResource({ serviceName, serviceVersion, environment, agentVersion? })` carries `service.name`, `service.version`, `deployment.environment` and, when given, `d2r.agent.version`; no host or process attribute
- [x] tests `carries service name, version and environment` and `carries the agent version only for the agent` pass

**Tests**: unit
**Gate**: Telemetry

---

#### Phase 2: Telemetry SDK wrappers and rules

### T7: Redacting exporters and the log cap

**What**: `RedactingSpanExporter` and `RedactingLogRecordExporter` copy each record, redact it and cap log volume.
**Where**: `packages/telemetry/src/sdk/redacting-exporters.ts`
**Depends on**: T6
**Reuses**: T3 `redactAttributes`, `scrubText`
**Requirement**: OBS-28, OBS-27, OBS-26

**Done when**:

- [x] span events: attributes redacted, `exception.message` and `exception.stacktrace` removed, `exception.type` kept; status message cleared; link attributes redacted; resource attributes outside `service.*`, `deployment.environment`, `d2r.agent.version`, `telemetry.sdk.*` removed; ended spans are not mutated
- [x] log records pass the allow-list of keys (`level, time, msg, trace_id, span_id, reqId, req.method, res.statusCode, responseTime, d2r.*`), the body goes through `scrubText`, and only `warn` and above or records tied to a sampled span pass, at most 20 a second
- [x] tests `removes exception message and stacktrace from span events`, `drops req.url and err keys from log records`, `caps exported log records at 20 a second` pass

**Tests**: unit
**Gate**: Telemetry

---

### T8: Bounded metric views

**What**: `boundedMetricViews` limits metric attributes to the bounded sets and drops the HTTP instrumentation's duration histogram.
**Where**: `packages/telemetry/src/sdk/views.ts`
**Depends on**: T7
**Reuses**: `@opentelemetry/sdk-metrics` `ViewOptions`
**Requirement**: OBS-31

**Done when**:

- [x] one view per instrument of `INSTRUMENT_NAMES` with `attributeKeys` from the bounded sets; a drop view for the instrumentation's own `http.server.request.duration`
- [x] test `metric attributes are limited to the bounded sets` records an id attribute and asserts it is absent from the collected point

**Tests**: unit
**Gate**: Telemetry

---

### T9: The Node SDK bootstrap

**What**: `startNodeTelemetry` wires the resource, sampler, redacting exporters, views, metric reader and log provider, and returns a handle.
**Where**: `packages/telemetry/src/node-sdk.ts`
**Depends on**: T8
**Reuses**: T5 to T8; OTLP HTTP exporters
**Requirement**: OBS-01

**Done when**:

- [x] with an endpoint it exports traces, metrics and logs over OTLP/HTTP with the given headers and metric interval; `shutdown()` flushes; export errors go to `onExportError`, limited to one a minute
- [x] it reads no `process.env` and `redirect` is not followed where the exporter has the option
- [x] tests `exports traces and metrics to the endpoint` (against a local HTTP recorder) and `reports at most one export error a minute` pass

**Tests**: unit
**Gate**: Telemetry

---

### T10: Forbid `process.env` in the telemetry package

**What**: an ESLint `n/no-process-env` block for `packages/telemetry/src/**` with a fixture test.
**Where**: `packages/config/eslint.mjs`
**Depends on**: T9
**Reuses**: the existing block for `apps/api/src/**`; `packages/config/test/rules.test.ts`
**Requirement**: OBS-39

**Done when**:

- [x] the new block is an error for `packages/telemetry/src/**`; the rule is only tightened
- [x] test `reports process.env in the telemetry package` fails without the block and passes with it; `pnpm lint` is clean

**Tests**: unit
**Gate**: Config

---

### T11: Cruiser rules for the telemetry entries

**What**: dependency-cruiser keeps SDK code out of `application` and `domain` and the root entry free of SDK packages.
**Where**: `.dependency-cruiser.cjs`
**Depends on**: T10
**Reuses**: `application-no-adapters`, `scripts/test/` fixture pattern
**Requirement**: OBS-41, OBS-22

**Done when**:

- [x] `application-no-adapters` also matches `@opentelemetry/(sdk-|exporter-|resources|instrumentation-)` and `^packages/telemetry/src/(node-sdk|web-sdk|tracing-fetcher|sdk/)`; the new rule `telemetry-root-has-no-sdk` is added
- [x] tests `an application file importing the telemetry node entry fails`, `the telemetry root files import no sdk package` and `the telemetry root entry lists exactly its files` pass in `scripts/test/telemetry-rules.test.mjs`
- [x] `pnpm arch` is clean on the tree

**Tests**: unit
**Gate**: Harness

---

#### Phase 3: API bootstrap

### T12: Telemetry settings in the API config and `.env.example`

**What**: `loadConfig` reads and validates the `OTEL_*` settings; `.env.example` lists them with placeholders.
**Where**: `apps/api/src/main/config.ts`
**Depends on**: T11
**Reuses**: `flag()` and `integer()` helpers; `.gitleaks.toml` allowlist for `.env.example`
**Requirement**: OBS-40, OBS-43

**Done when**:

- [x] `telemetry: { endpoint, headers, samplerArg, intervalMs }`; the endpoint must be `https:` unless the host is loopback, with no user info; the sampler argument is a number in `[0, 1]`; `OTEL_METRIC_EXPORT_INTERVAL` defaults to `60000`; the headers are never printed
- [ ] `.env.example` at the repo root lists every `OTEL_*` variable the config reads with placeholder values; `pnpm secrets:scan` is clean
- [ ] tests `rejects an http endpoint off loopback and an endpoint with user info`, `defaults the sampler ratio and the metric interval` in `config.test.ts` and `.env.example lists every OTEL variable the config reads` in `scripts/test/env-example.test.mjs` pass

**Tests**: unit
**Gate**: API unit

---

### T13: The preload and the instrumentation (spike with a gate)

**What**: `main/instrument.ts` installs the SDK before the application imports and instruments HTTP, Fastify and `pg`.
**Where**: `apps/api/src/main/instrument.ts`
**Depends on**: T12
**Reuses**: T9 `startNodeTelemetry`; design § API bootstrap and its fallback
**Requirement**: OBS-01, OBS-03

**Done when**:

- [ ] with `OTEL_EXPORTER_OTLP_ENDPOINT` set, booting `local.ts` with `--import` produces a server span, a `pg` child span naming the statement with placeholders and no bound value, and exports traces and metrics to a fake OTLP backend; unset, the preload does nothing; a load error is caught and logged once; `/healthz` and the relay route are excluded from server spans; header capture options stay unset
- [ ] the versions of the instrumentation packages are pinned and listed in `## Handoff`; if the spike used the design's fallback, that is recorded
- [ ] tests `exports traces and metrics to the configured endpoint` and `pg span names the statement without parameter values and is a child of the server span` in `apps/api/src/main/__tests__/instrument.int.test.ts` pass

**Tests**: integration
**Gate**: API full

---

### T14: Start both roots through the preload

**What**: `render.yaml`, the acceptance stack and the package scripts start the roots with `--import`; both roots run with the endpoint unset.
**Where**: `render.yaml`
**Depends on**: T13
**Reuses**: `tests/acceptance/support/stack.ts` spawn arguments; `apps/api/package.json` scripts
**Requirement**: OBS-02

**Done when**:

- [ ] the Render start command, the `dev`/`start` scripts of the API and the two `node src/main/local.ts` spawns in `stack.ts` carry `--import ./src/main/instrument.ts`; `render.yaml` adds only variable names, no value
- [ ] test `both roots start with no OTLP endpoint and answer a health check` in `roots.int.test.ts` passes; the existing acceptance stack still boots (`pnpm --filter @d2rmm/acceptance exec bddgen` clean)

**Tests**: integration
**Gate**: API full

---

### T15: Log correlation and log export

**What**: the Fastify logger carries `trace_id` and `span_id` and exports logs through the redacting exporter; `console.error` calls use the logger.
**Where**: `apps/api/src/main/app.ts`
**Depends on**: T14
**Reuses**: `REDACTED_LOG_PATHS`, `logSink`; `outbox-relay.ts:85,165`, `stream-hub.ts:327`, `app.ts:214` call sites
**Requirement**: OBS-26, OBS-27

**Done when**:

- [ ] a `mixin` reads the active span; a request log line inside a span carries both ids and outside carries none; the three `console.error` sites call an injected logger
- [ ] with the endpoint set a request log record reaches a fake OTLP backend with the trace id
- [ ] tests `log line inside a span carries trace_id and span_id and none outside` (unit) and `exports a log record with the trace id` (integration) pass

**Tests**: integration
**Gate**: API full

---

### T16: Request duration and body size metrics

**What**: a Fastify `onResponse` hook records `http.server.request.duration` and `http.server.response.body.size` by route template and status class.
**Where**: `apps/api/src/platform/http/request-metrics.ts`
**Depends on**: T15
**Reuses**: T2 `INSTRUMENT_NAMES`; T8 views; `buildApp` hook registration
**Requirement**: OBS-33

**Done when**:

- [ ] both histograms use `http.route` (template) and `http.response.status_class` only; an id in the path never becomes an attribute; hijacked streams record nothing
- [ ] test `records request duration and body size by route template and status class` passes with an in-memory metric reader

**Tests**: integration
**Gate**: API full

---

#### Phase 4: The outbox carries the trace

### T17: The `trace_context` column

**What**: migration `0002_outbox_trace_context` adds a nullable text column; the Kysely type and the migrator map know it.
**Where**: `apps/api/migrations/0002_outbox_trace_context.ts`
**Depends on**: T16
**Reuses**: `0001_skeleton.ts` migration shape; `platform/postgres/migrator.ts` map; `platform/postgres/database.ts` `OutboxTable`
**Requirement**: OBS-05

**Done when**:

- [ ] a new file, never an edit of `0001`; `up` adds `trace_context text null`, `down` drops it; `OutboxTable.trace_context: string | null`; the map has the `0002` entry
- [ ] test `migrates to 0002 and back` in `platform/postgres/migrator.int.test.ts` passes on a Testcontainers database

**Tests**: integration
**Gate**: API full

---

### T18: Write the trace context with the event

**What**: `PostgresOutbox.append` stores the active span's `traceparent` in the same insert.
**Where**: `apps/api/src/platform/postgres/outbox.ts`
**Depends on**: T17
**Reuses**: T4 `traceparentOf`; `withSpan`
**Requirement**: OBS-05

**Done when**:

- [ ] every row of one `append` carries the traceparent of the active span, `null` when there is none, written in the transaction and rolled back with it
- [ ] test `append stores the traceparent of the active span in the transaction` in `outbox.int.test.ts` passes

**Tests**: integration
**Gate**: API full

---

### T19: The relay continues the stored trace

**What**: `OutboxRelay` publishes each row inside `platform.outbox.relay` as a child of the stored context, or a root span when there is none.
**Where**: `apps/api/src/platform/outbox-relay.ts`
**Depends on**: T18
**Reuses**: T4 `contextFromTraceparent`; `ROOT_CONTEXT`; the batch select
**Requirement**: OBS-06, OBS-07

**Done when**:

- [ ] the batch selects `trace_context`; each row runs under `context.with(...)`; a missing or malformed value uses `ROOT_CONTEXT`; the row never fails because of it; attribute `d2r.outbox.event_type`
- [ ] tests `continues the stored context and opens platform.outbox.relay as its child` and `publishes a row with no trace context as a root span` in `outbox-relay.int.test.ts` pass

**Tests**: integration
**Gate**: API full

---

### T20: Stream delivery span and the connections counter

**What**: `StreamHub` opens `platform.stream.deliver` per accepted delivery and counts connections.
**Where**: `apps/api/src/platform/stream-hub.ts`
**Depends on**: T19
**Reuses**: `Connection.#accepts`, `#dispatch`; `INSTRUMENT_NAMES`
**Requirement**: OBS-06, OBS-33

**Done when**:

- [ ] `platform.stream.deliver` is a child of the active relay span for each connection that accepts the event, attribute `d2r.stream.kind`; `sse.connections` goes up when a connection joins and down in its `onClose`
- [ ] tests `delivers inside a span that is a child of the outbox relay` and `sse.connections goes up and down with the connection` in `stream-hub.int.test.ts` pass

**Tests**: integration
**Gate**: API full

---

### T21: The outbox lag gauge

**What**: `outbox.lag` observes the age of the oldest unpublished row.
**Where**: `apps/api/src/platform/outbox-lag.ts`
**Depends on**: T20
**Reuses**: the partial index on `(id)`; the injected `Clock`
**Requirement**: OBS-33

**Done when**:

- [ ] the gauge reads `created_at` of the first row `where published_at is null and failed_at is null order by id limit 1`, in seconds, `0` when none, computed with the `Clock`; registered once from `buildApp`
- [ ] test `outbox.lag is the age of the oldest unpublished row and 0 when none` passes

**Tests**: integration
**Gate**: API full

---

#### Phase 5: Span attributes and the room metric

### T22: Drop account and agent ids from identity and agents spans

**What**: the use-case spans of `identity` and `agents` stop carrying `accountId`/`agentId`.
**Where**: `apps/api/src/modules/agents/application/record-heartbeat.ts`
**Depends on**: T21
**Reuses**: the span list of the recon (AD-091); `withSpan`
**Requirement**: OBS-30

**Done when**:

- [ ] `identity.get-me`, `agents.record-heartbeat`, `agents.get-my-agent`, `agents.account-of-agent`, `agents.current-agent-of` open spans without an id attribute; span names unchanged
- [ ] test `no span of identity or agents carries an account or agent id` passes with an in-memory exporter

**Tests**: unit
**Gate**: API unit

---

### T23: Rename and drop in the lobby and matchmaking spans

**What**: `lobby.record-observation` uses `d2r.room.id`; `matchmaking.form-test-match`, `lobby.get-current-room` and `lobby.get-assignment` drop their ids.
**Where**: `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.ts`
**Depends on**: T22
**Reuses**: T2 constants
**Requirement**: OBS-30

**Done when**:

- [ ] `d2r.room.id` replaces `roomId`; `accountId` and `agentId` are gone from the lobby spans and from `form-test-match.ts`; span names unchanged (AWS-35 tests stay green)
- [ ] test `no span of lobby or matchmaking carries an account or agent id and the room id uses the d2r constant` passes

**Tests**: unit
**Gate**: API unit

---

### T24: The clock and the opening instant in the lobby

**What**: `LobbyRoomDeps` gains `clock` and the repository port gains `openedAt(roomId)`.
**Where**: `apps/api/src/modules/lobby-room/application/ports.ts`
**Depends on**: T23
**Reuses**: `lobby.rooms.created_at`; `InMemoryLobbyRoomRepository`; `buildApp` wiring; test factories
**Requirement**: OBS-34

**Done when**:

- [ ] `openedAt` is on the port, the Postgres repository and the in-memory fake; `buildApp` and every test factory pass `clock`; the domain still holds no timestamp
- [ ] test `openedAt returns the instant the room opened` (unit, fake) and its integration counterpart pass

**Tests**: integration
**Gate**: API full

---

### T25: The `room.stage_duration` metric

**What**: `RoomMetrics` port, its OpenTelemetry adapter and its fake; `lobby.record-observation` records it once when a room becomes `created`.
**Where**: `apps/api/src/modules/lobby-room/adapters/telemetry/otel-room-metrics.ts`
**Depends on**: T24
**Reuses**: T2 `INSTRUMENT_NAMES`; T8 views; the application-port pattern
**Requirement**: OBS-34

**Done when**:

- [ ] the use case calls `stageLeft('awaiting_host', difficulty, mode, seconds)` once, in the `created` branch, with `clock.now() - openedAt`; a repeated sighting records nothing
- [ ] tests `records room.stage_duration once with the seconds since the room opened` (application, `FakeClock`) and `the adapter records the histogram with bounded attributes` pass

**Tests**: unit
**Gate**: API unit

---

#### Phase 6: The relay building blocks

### T26: The relay limiter

**What**: `RelayLimiter` with separate principal and address maps, caps, overflow bucket, sweep and mapped-IPv4 handling.
**Where**: `apps/api/src/platform/http/relay-limiter.ts`
**Depends on**: T25
**Reuses**: `rateLimitKey` logic (copied), `scheduler.every`
**Requirement**: OBS-14

**Done when**:

- [ ] sliding window per key; principals capped at 50 000 (fail closed for a new key only), addresses at 10 000 with one overflow bucket for credential-less callers; an unparseable address maps to one fixed bucket; `::ffff:a.b.c.d` keys as its IPv4 string; swept every 30 s
- [ ] tests `counts credential-less requests per address and refuses the 121st`, `an address cap overflow never blocks a principal`, `an unparseable address uses one bucket`, `an IPv4-mapped IPv6 address keys as IPv4`, `sweeps expired keys` pass

**Tests**: unit
**Gate**: API unit

---

### T27: The egress budgets

**What**: per-account and relay-wide byte and request counters (minute and UTC day), with refunds.
**Where**: `apps/api/src/platform/http/relay-budget.ts`
**Depends on**: T26
**Reuses**: the injected `Clock`; T26 window helper
**Requirement**: OBS-14

**Done when**:

- [ ] per account: 60 requests, 2 MiB a minute, 2 MiB a UTC day; relay-wide: 4 MiB a minute, 16 MiB a UTC day; an agent counts as its account; bytes are charged as they stream; a refund returns bytes of a refused request or a dropped forward; a refusal carries the `Retry-After` of its window
- [ ] tests `refuses the sixty-first request in a minute`, `an agent and its account share one budget`, `refuses past the daily relay allowance until midnight UTC`, `refunds bytes of a dropped forward` pass with `FakeClock`

**Tests**: unit
**Gate**: API unit

---

### T28: `beforeLookup` and `throttled` on `authenticateAgent`

**What**: the use case takes an optional `beforeLookup` called only on a cache miss; the public port and its callers know `throttled`.
**Where**: `apps/api/src/modules/agents/application/authenticate-agent.ts`
**Depends on**: T27
**Reuses**: `agents/index.ts` `AgentsPort`; the in-memory fake; `guards.ts` and `stream-hub.ts` callers
**Requirement**: OBS-14

**Done when**:

- [ ] a cache hit never calls `beforeLookup`; a miss calls it, and `false` returns the error `throttled` without reading the repository; `AgentsPort.authenticateAgent(token, opts?)` widens its error to `'unauthenticated' | 'throttled'`; the guards and the hub still answer `401` for `unauthenticated` and treat `throttled` as defined in T29
- [ ] tests `a cache hit does not call beforeLookup`, `a miss with beforeLookup false returns throttled without a repository call`, `a miss with beforeLookup true authenticates` pass

**Tests**: unit
**Gate**: API unit

---

### T29: The relay guard and the origin-only check

**What**: `requireAgentOrSite` selects the bearer or cookie path, takes a lookup token on a miss and checks the origin exactly.
**Where**: `apps/api/src/platform/http/guards.ts`
**Depends on**: T28
**Reuses**: `bearerToken`, `sessionCookieValue`, `requireSameOrigin` (not reused: it needs JSON); the lookup bucket from T26
**Requirement**: OBS-11, OBS-17

**Done when**:

- [ ] `Authorization` present selects the bearer path and never the cookie; an empty cookie is credential-less; a credential that misses the cache takes a token of the lookup bucket (10 a second, 3 at once) and `429` with `Retry-After: 1` when empty; a valid session whose `Origin` is missing or not exactly the site origin is `403`; `requireAgentVersion` is not applied (AD-099)
- [ ] tests `no credential gets 401`, `an empty session cookie is credential-less`, `a missing, wrong, slash-suffixed or subdomain origin gets 403`, `an empty lookup bucket gets 429 without a repository call` pass

**Tests**: unit
**Gate**: API unit

---

### T30: The forwarder

**What**: `Forwarder` posts the body unchanged to the backend in the background with a timeout, no redirect, bounded and with no leak.
**Where**: `apps/api/src/platform/http/relay-forwarder.ts`
**Depends on**: T29
**Reuses**: `fetch`; the injected logger
**Requirement**: OBS-15, OBS-16

**Done when**:

- [ ] `fetch(endpoint + '/v1/traces', { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: content-type + credentials })`; a failure or redirect logs one warning without body, headers or credentials and never retries; the response body is cancelled; at most 32 forwards and 8 MiB in flight, a further one dropped with a warning; no endpoint means drop
- [ ] tests `forwards the body unchanged with the backend credentials`, `a redirect is refused and a failure is logged once without credentials`, `drops the 33rd concurrent forward`, `cancels the backend response body` pass with a fake `fetch`

**Tests**: unit
**Gate**: API unit

---

#### Phase 7: The relay route

### T31: The relay plugin

**What**: `POST /v1/telemetry/traces` is registered with scoped parsers, the check order in `onRequest`, streamed-byte charging and the empty `202`.
**Where**: `apps/api/src/platform/http/telemetry-relay.ts`
**Depends on**: T30
**Reuses**: T26 to T30; `answerError`; `buildApp` registration; the 4 KB `bodyLimit` pattern of the lobby routes
**Requirement**: OBS-10, OBS-13, OBS-20

**Done when**:

- [ ] order: credential-less address bucket (`429` when over 120, else `401`) or authentication (failures counted); request count; budgets already exhausted; content type (`application/x-protobuf`, `application/json`) and `content-encoding` absent or `identity` (`415`); declared length over 1 MiB (`413`); a `preParsing` hook charges streamed bytes and a body over 1 MiB fails with `413`; a 10 s body-read timeout; reply `202` with no content, then forward
- [ ] tests `a valid batch is answered 202 with no content and forwarded once`, `a body of 1 MiB plus one byte gets 413 and nothing is forwarded`, `content-encoding other than identity gets 415` in `telemetry-relay.int.test.ts` pass

**Tests**: integration
**Gate**: API full

---

### T32: The route in the contract

**What**: the Zod response schemas for the relay, `openapi.json` regenerated and the `ROUTES` list updated.
**Where**: `packages/contracts/src/http/platform.ts`
**Depends on**: T31
**Reuses**: `ErrorResponse`; `openapi.int.test.ts` `ROUTES`; `pnpm contracts:openapi`
**Requirement**: OBS-42

**Done when**:

- [ ] `202`, `401`, `403`, `413`, `415`, `429` are declared; `pnpm contracts:openapi` leaves `openapi.json` committed with `/v1/telemetry/traces`; `ROUTES` lists it
- [ ] test `openapi documents the telemetry relay` and `pnpm contracts:check` pass

**Tests**: integration
**Gate**: API full

---

### T33: The relay against a fake backend

**What**: integration tests cover every status, the check order table and the dead-backend runs.
**Where**: `apps/api/src/platform/http/telemetry-relay-order.int.test.ts`
**Depends on**: T32
**Reuses**: a fake HTTP backend helper; the app factory with a Testcontainers database
**Requirement**: OBS-11, OBS-14, OBS-15, OBS-16, OBS-37

**Done when**:

- [ ] table rows: a valid agent gets `202` while the address bucket is full; a credential-less caller at 121 a minute gets `429` before `401`; a failed credential over the limit gets `401`; an empty lookup bucket gets `429` without a repository call; wrong origin `403` before rate; rate before type; type before size
- [ ] the backend answering headers and a body leaves the relay response and the logs free of them and of the credentials; the API suite run against a closed port answers every request as with a reachable backend and logs at most one export error a minute
- [ ] tests `the relay applies its checks in order`, `a valid agent is accepted while the address bucket is full`, `returns no backend header or body and logs no credentials`, `answers identically against a closed port` pass

**Tests**: integration
**Gate**: API full

---

#### Phase 8: The site

### T34: `tracestate` through the Pages proxy

**What**: the proxy forwards `tracestate` (dropped when over 512 bytes) with `traceparent`.
**Where**: `apps/web/functions/api/[[path]].ts`
**Depends on**: T33
**Reuses**: `ALLOWED_REQUEST_HEADERS`; `api-proxy.test.ts` `recordingUpstream`
**Requirement**: OBS-09

**Done when**:

- [ ] `tracestate` is on the allow-list; a value over 512 bytes is dropped; `/api/v1/telemetry/traces` still matches the path pattern
- [ ] tests `forwards traceparent and tracestate to the API` and `drops an oversized tracestate` pass

**Tests**: unit
**Gate**: Web

---

### T35: The web SDK and the tracing fetcher

**What**: `startWebTelemetry` and `tracingFetcher` in the telemetry package's web entry.
**Where**: `packages/telemetry/src/web-sdk.ts`
**Depends on**: T34
**Reuses**: T5 sampler; T7 redacting exporter; `sdk-trace-web`, OTLP JSON exporter
**Requirement**: OBS-04, OBS-21, OBS-44

**Done when**:

- [ ] `startWebTelemetry({ enabled, ratio, relayPath, serviceVersion, environment })` creates the provider and a batch processor (5 s, 100 spans a batch, queue 256) only when `enabled`; disabled installs nothing; the exporter targets `/api/v1/telemetry/traces`
- [ ] `tracingFetcher(base)` opens a client span, sets `url.path` without the query and injects `traceparent`; `tracedAction` and `navigationSpan` exist
- [ ] tests `no exporter is created unless enabled`, `exporter targets the relay path`, `tracing fetcher sends traceparent and records the path without the query` pass

**Tests**: unit
**Gate**: Telemetry

---

### T36: Wire the site

**What**: the site starts telemetry, builds its client with the tracing fetcher and wraps "Start test match" in an action span.
**Where**: `apps/web/src/main.tsx`
**Depends on**: T35
**Reuses**: `apps/web/src/shared/telemetry.ts` (new), `app/App.tsx` `defaultClient`, `StartTestMatchButton.tsx`, new `vite-env.d.ts`
**Requirement**: OBS-04, OBS-44

**Done when**:

- [ ] `VITE_TELEMETRY` and `VITE_TELEMETRY_RATIO` are typed in `src/vite-env.d.ts`; telemetry starts before render only when `VITE_TELEMETRY === 'on'`; the button runs `client.matchFormed()` inside `tracedAction('web.action.start-test-match', …)`; one `web.navigation` span at start and on `popstate`
- [ ] tests `the navigation span holds the path alone` and `the start test match click sends a traceparent` pass; the locale parity test and `no-literal-string` stay green

**Tests**: unit
**Gate**: Web

---

### T37: The flags stay off in production

**What**: a harness test asserts the release and deploy workflows never set the telemetry flags.
**Where**: `scripts/test/telemetry-flags.test.mjs`
**Depends on**: T36
**Reuses**: `deploy-web.yml`, `release-agent.yml`, the `scripts/test/deploy-workflows.test.mjs` pattern
**Requirement**: OBS-44

**Done when**:

- [ ] test `release and deploy workflows leave VITE_TELEMETRY and D2RMM_TELEMETRY unset` passes and fails on a fixture workflow that sets one
- [ ] the e2e site build setting is only in the acceptance support code (T51)

**Tests**: unit
**Gate**: Harness

---

#### Phase 9: The agent exporter

### T38: The bounded queue

**What**: `BoundedQueue<T>` of capacity 2048 that drops the oldest.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/queue.rs`
**Depends on**: T37
**Reuses**: `telemetry.rs` renamed to `telemetry/mod.rs`
**Requirement**: OBS-18

**Done when**:

- [ ] `telemetry.rs` becomes `telemetry/mod.rs` unchanged in behaviour; `push` drops the oldest at capacity; `drain(max)` returns oldest first
- [ ] test `a full queue of 2048 drops the oldest span` and `drain returns the oldest first` pass; the queue is added to `.cargo/mutants.toml`

**Tests**: unit
**Gate**: Rust adapters

---

### T39: The relay client and its outcomes

**What**: `outcome_of`, `HeaderSource` and `RelayHttpClient` over `reqwest` without redirects.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/relay_client.rs`
**Depends on**: T38
**Reuses**: `http/client.rs` builder style; `opentelemetry_http::HttpClient`
**Requirement**: OBS-19

**Done when**:

- [ ] `outcome_of(status, retry_after, now)` maps `403/413/415` to drop, `401` to drop and stop while the token hash equals the refused one, `429` to wait `Retry-After` (60 s absent, 1 h cap); the client is built with `redirect::Policy::none()` and rustls, adds `Authorization` and `X-Agent-Version` from the `HeaderSource` per request and never logs the token
- [ ] tests `401 403 413 415 drop the batch`, `401 stops export until the token changes`, `429 waits for retry-after capped at one hour`, `429 without retry-after waits sixty seconds` pass; the module is added to `.cargo/mutants.toml`

**Tests**: unit
**Gate**: Rust adapters

---

### T40: Sanitize the agent's spans

**What**: `SanitizingExporter` drops events, links and status text, keeps exact attribute keys and truncates strings.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/sanitize.rs`
**Depends on**: T39
**Reuses**: design § Agent exporter
**Requirement**: OBS-28, OBS-30

**Done when**:

- [ ] only the exact keys of the design survive; strings are cut at 128 characters; span names must start with `agent.`; the resource holds only `service.*`, `deployment.environment`, `d2r.agent.version`
- [ ] test `drops window title, process path, screen text, urls, events with paths and status text` passes; the module is added to `.cargo/mutants.toml`

**Tests**: unit
**Gate**: Rust adapters

---

### T41: Init, resource, sampler and the log gate

**What**: `init(mode, export)` returns a guard, builds the resource and the parent-based ratio sampler, and `LogGate` limits export errors.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/mod.rs`
**Depends on**: T40
**Reuses**: T5 vector file; existing `Mode`, `level_filter`, `traceparent_for`
**Requirement**: OBS-32, OBS-43

**Done when**:

- [ ] the provider carries `service.name=d2rmm-agent`, version, environment and `d2r.agent.version`; the sampler decisions match `packages/telemetry/test-vectors/sampler.json`; `LogGate` lets one export error a minute through; `TelemetryGuard::shutdown()` flushes
- [ ] tests `agent resource carries the agent version`, `sampler decisions match the shared vector`, `log gate allows one error a minute` pass

**Tests**: unit
**Gate**: Rust adapters

---

### T42: The OTLP crates and the architecture rules

**What**: the adapters manifest gains the OTLP crates on rustls; the architecture test forbids them outside adapters.
**Where**: `apps/agent/src-tauri/adapters/Cargo.toml`
**Depends on**: T41
**Reuses**: `scripts/test/agent-architecture.test.mjs` (core and domain deny lists); `deny.toml` (read only)
**Requirement**: OBS-22

**Done when**:

- [ ] `opentelemetry-otlp` (`http-proto`, `trace`, `reqwest-client`) and `opentelemetry-http` at the locked 0.33 line, no `native-tls`; `Cargo.lock` committed; `cargo deny check` passes without editing `deny.toml` (a failure stops the task as a maintainer decision)
- [ ] test `domain and core manifests hold no tracing or OpenTelemetry crate and the exporter lives in adapters` passes and its fixture fails when `opentelemetry-otlp` is added to core

**Tests**: unit
**Gate**: Harness

---

### T43: The drop-oldest processor and the export task

**What**: `DropOldestProcessor` over the queue and a spawned export task that never blocks a caller.
**Where**: `apps/agent/src-tauri/adapters/src/telemetry/export.rs`
**Depends on**: T42
**Reuses**: T38 to T41; `tokio::spawn` as in the core runtime
**Requirement**: OBS-18, OBS-19, OBS-38

**Done when**:

- [ ] `on_end` never awaits; the task exports every 5 s in batches of at most 256 through the sanitizer and the relay client; an unreachable relay never stops a loop and logs once a minute
- [ ] tests `a slow relay never delays a caller` and `the loops keep running when the relay is unreachable` pass (paused tokio time, fake relay)

**Tests**: unit
**Gate**: Rust adapters

---

#### Phase 10: The agent example and its guards

### T44: The `fixture-read` feature on the adapters crate and its guards

**What**: the adapters crate gets a `fixture-read` feature (`dep:image`, never default) and the source rules cover it.
**Where**: `apps/agent/src-tauri/adapters/Cargo.toml`
**Depends on**: T43
**Reuses**: `scripts/test/agent-source-rules.test.mjs` `fixtureReadViolations`; `release-agent.yml` guard
**Requirement**: OBS-24

**Done when**:

- [ ] both manifests carry a comment naming the other `fixture-read`; the default-feature rule reads both manifests and a new fixture manifest with the feature in `default` makes it fail
- [ ] tests `fixture-read is never a default feature in either manifest`, `cargo tree for the app crate holds no fixture-read`, `release-agent.yml builds no example and enables no all-features` pass; `cargo deny check` passes with `dep:image`

**Tests**: unit
**Gate**: Harness

---

### T45: The loopback rule and `HeaderSource` for the example

**What**: a Rust test pins that `AllowLoopbackHttp::Yes` accepts literal loopback hosts only.
**Where**: `apps/agent/src-tauri/adapters/src/config.rs`
**Depends on**: T44
**Reuses**: `ApiBase`, `AllowLoopbackHttp`
**Requirement**: OBS-24

**Done when**:

- [ ] the rule accepts `127.0.0.0/8`, `::1` and `localhost` over http and refuses any other host; `AllowLoopbackHttp::Yes` is constructed only in the app crate's debug path and in the example
- [ ] test `loopback http is accepted for literal loopback hosts only` passes

**Tests**: unit
**Gate**: Rust adapters

---

### T46: The headless example

**What**: `examples/headless.rs` drives the real core, gateway and exporter with a sidecar-text reader, over stdin and stdout.
**Where**: `apps/agent/src-tauri/adapters/examples/headless.rs`
**Depends on**: T45
**Reuses**: `Runtime::start`, `Handle::read_once`, `HttpGateway`, the adapters test fakes for ports the example fakes; design § Agent exporter
**Requirement**: OBS-24

**Done when**:

- [ ] `required-features = ["fixture-read"]`; arguments `--api-base`, `--read-fixture <png>`; an in-memory token store, a process source that reports the game open, a `TextReader` returning the sidecar `<png>.txt`; export config always on with ratio 1; stdout lines `code`, `paired`, `assignment`, `observed`; one `read` line on stdin calls `read_once` once for the held room
- [ ] test `the example prints its lines and reads the sidecar text once` runs the example against a fake API in `adapters/tests/headless.rs` (feature `fixture-read`) and passes; `cargo build --release -p d2rmm-agent-adapters` builds no example

**Tests**: integration
**Gate**: Rust adapters

---

#### Phase 11: Local backend and dashboard

### T47: The compose file and the scripts

**What**: `infra/observability/compose.yaml` and the `obs:up`/`obs:down` scripts.
**Where**: `infra/observability/compose.yaml`
**Depends on**: T46
**Reuses**: design § Local backend
**Requirement**: OBS-23

**Done when**:

- [ ] the image `grafana/otel-lgtm` pinned by tag and digest (read from `docker pull`, recorded in `## Handoff`); ports bound to `127.0.0.1` (3000, 4317, 4318, 3200); the dashboards mount and a provisioning provider file; `package.json` defines `obs:up` and `obs:down`
- [ ] tests `compose pins the image tag and digest and binds loopback` and `package.json defines obs:up and obs:down` in `scripts/test/observability-infra.test.mjs` pass

**Tests**: unit
**Gate**: Harness

---

### T48: The skeleton dashboard

**What**: `skeleton.json` with the request-rate, error-rate, duration, `outbox_lag` and `sse_connections` panels, provisioned by compose.
**Where**: `infra/observability/dashboards/skeleton.json`
**Depends on**: T47
**Reuses**: the Prometheus metric names of `INSTRUMENT_NAMES`
**Requirement**: OBS-35

**Done when**:

- [ ] the five panels exist, filter on `service_name="d2rmm-api"` and carry no secret
- [ ] tests `the dashboard holds the listed panels` and `compose provisions the dashboard` pass

**Tests**: unit
**Gate**: Harness

---

### T49: Dashboard and code agree

**What**: a test compares the metrics every panel queries with the instruments the code defines.
**Where**: `packages/telemetry/src/dashboard-metrics.test.ts`
**Depends on**: T48
**Reuses**: `INSTRUMENT_NAMES`; the dashboard JSON read as text
**Requirement**: OBS-36

**Done when**:

- [ ] every metric name in a panel query maps to an entry of `INSTRUMENT_NAMES` (with the Prometheus name mapping documented in the test); a fixture dashboard with an undefined metric fails
- [ ] test `every dashboard metric is defined by the code` passes

**Tests**: unit
**Gate**: Telemetry

---

#### Phase 12: Acceptance and close

### T50: The backend helper and the Docker failure

**What**: `startTelemetryBackend` starts `otel-lgtm` with Testcontainers and names Docker when it is missing.
**Where**: `tests/acceptance/support/telemetry-backend.ts`
**Depends on**: T49
**Reuses**: `global-setup.ts` Testcontainers use; the image line of `compose.yaml`
**Requirement**: OBS-25

**Done when**:

- [ ] the helper parses the image line, waits for Tempo and returns its query URL and OTLP URL; with no Docker socket it throws an error whose message names Docker
- [ ] test `fails naming Docker when the socket is absent` passes (unit, no Docker needed)

**Tests**: unit
**Gate**: Acceptance

---

### T51: The traced stack and the fake backend

**What**: `Stack.startTracedStack({ otlpEndpoint })` and `FakeTelemetryBackend`, with the site built for telemetry.
**Where**: `tests/acceptance/support/stack.ts`
**Depends on**: T50
**Reuses**: `launch`, `freePort`, `waitFor`, `apiEnv`; the Pages dev server spawn
**Requirement**: OBS-24

**Done when**:

- [ ] the traced stack starts a staging API with the preload, `OTEL_EXPORTER_OTLP_ENDPOINT`, sampler `1.0`, metric interval 5 s, and a Pages dev server on a site built with `VITE_TELEMETRY=on` and ratio `1`; `apiEnv` passes the new variables; `FakeTelemetryBackend` records requests and can refuse, hang or answer an error
- [ ] the existing acceptance scenarios still pass with the site built with telemetry on (`pnpm test:acceptance` green once, recorded in `## Handoff`)

**Tests**: acceptance
**Gate**: Acceptance

---

### T52: Read traces back and scan for leaks

**What**: `trace-reader.ts` polls Tempo and checks edges; the scan walks everything exported for forbidden content.
**Where**: `tests/acceptance/support/trace-reader.ts`
**Depends on**: T51
**Reuses**: `forbidden-keys.ts` (copy of the package list); Tempo HTTP API
**Requirement**: OBS-24, OBS-28

**Done when**:

- [ ] `readTrace(traceId)` polls for 30 s and returns names and parent edges; `assertTraceA` and `assertTraceB` check the edges of OBS-08 and OBS-12; both trace ids are printed; the scan covers spans, metrics and logs for forbidden keys, query strings and the player name
- [ ] tests `prints both trace ids` and `the forbidden key lists of the acceptance code and the telemetry package are equal` (the latter in `packages/telemetry`) pass

**Tests**: unit
**Gate**: Acceptance

---

### T53: The headless agent helper and the trace steps

**What**: `headless-agent.ts` and `observability.steps.ts` run the two `@slow` trace scenarios.
**Where**: `tests/acceptance/steps/observability.steps.ts`
**Depends on**: T52
**Reuses**: `World`, the sign-in and test-match steps; `cargo run --example headless --features fixture-read`
**Requirement**: OBS-08, OBS-12, OBS-24

**Done when**:

- [ ] the steps for the scenarios "A test match leaves one trace…" and "The agent's observation leaves its own trace…" exist; the helper builds the example once, parses its stdout, writes the PNG and sidecar text and sends `read`
- [ ] the two scenarios pass with Docker available: trace A holds the site action, the request, a `pg` span, `platform.outbox.relay` and `platform.stream.deliver`; trace B has the agent span as parent of the API spans of its heartbeat and observation

**Tests**: acceptance
**Gate**: Acceptance

---

### T54: The relay steps

**What**: steps for the relay scenarios of `acceptance.feature`.
**Where**: `tests/acceptance/steps/telemetry-relay.steps.ts`
**Depends on**: T53
**Reuses**: `SimulatedAgent`, `World`, `FakeTelemetryBackend`
**Requirement**: OBS-10, OBS-11, OBS-13, OBS-14, OBS-15, OBS-17, OBS-20

**Done when**:

- [ ] every step of the relay scenarios exists (`missingSteps: 'fail-on-gen'` is clean); the outline rows and the rate, flood, address and backend-failure scenarios pass as written
- [ ] `pnpm acceptance:check` is clean

**Tests**: acceptance
**Gate**: Acceptance

---

### T55: CI builds the example and the telemetry site

**What**: the `integration` job installs a Rust toolchain, builds the headless example once and builds the site for the telemetry scenarios.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T54
**Reuses**: the `agent` job's toolchain setup; Docker on `ubuntu-latest`
**Requirement**: OBS-24

**Done when**:

- [ ] the job adds a pinned toolchain step with a `target` cache and the example build; no step is removed or loosened; every `uses:` added is SHA-pinned
- [ ] test `the integration job builds the headless example` in `scripts/test/ci-workflow.test.mjs` passes

**Tests**: unit
**Gate**: Harness

---

### T56: The close

**What**: the whole suite, the ratchet and the contract check pass together.
**Where**: `.specs/features/observability-e2e/tasks.md`
**Depends on**: T55
**Reuses**: every gate; `.quality-baseline.json` (read only)
**Requirement**: OBS-24

**Done when**:

- [ ] Build gate, `pnpm test:acceptance`, `pnpm contracts:check`, `pnpm harness:gate` and `pnpm quality:collect && pnpm quality:ratchet --context pr` pass; `git diff phase/F0...HEAD -- .quality-baseline.json` is empty
- [ ] the numbers are recorded in `## Handoff`

**Tests**: none
**Gate**: Build

---

## Checks

**C1** - With an OTLP endpoint set, the API exports traces and metrics to it over OTLP/HTTP (OBS-01, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.test.ts -t "exports traces and metrics to the configured endpoint"`

**C2** - Both composition roots start and answer a health check with no OTLP endpoint (OBS-02, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/roots.int.test.ts -t "both roots start with no OTLP endpoint and answer a health check"`

**C3** - A `pg` span names the statement without parameter values and is a child of the server span (OBS-03, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.test.ts -t "pg span names the statement without parameter values and is a child of the server span"`

**C4** - The site sends `traceparent` on an API call and records the path without the query (OBS-04, AC 4)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "tracing fetcher sends traceparent and records the path without the query"`

**C5** - The navigation span holds the path alone (OBS-04, AC 4)
Proof: `pnpm --filter @d2rmm/web exec vitest run src -t "the navigation span holds the path alone"`

**C6** - `append` stores the traceparent of the active span in the transaction (OBS-05, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/postgres/outbox.int.test.ts -t "append stores the traceparent of the active span in the transaction"`

**C7** - The relay continues the stored context and the delivery is its child (OBS-06, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-relay.int.test.ts -t "continues the stored context and opens platform.outbox.relay as its child"`

**C8** - The stream delivery span is a child of the outbox relay (OBS-06, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/stream-hub.int.test.ts -t "delivers inside a span that is a child of the outbox relay"`

**C9** - A row with no trace context is published as a root span (OBS-07, AC 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-relay.int.test.ts -t "publishes a row with no trace context as a root span"`

**C10** - One trace holds the site action, the request, a `pg` span, the outbox relay and the stream delivery (OBS-08, AC 8)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A test match leaves one trace through the site"`

**C11** - The proxy forwards `traceparent` and `tracestate` and drops an oversized `tracestate` (OBS-09, AC 9)
Proof: `pnpm --filter @d2rmm/web exec vitest run functions -t "forwards traceparent and tracestate to the API"`

**C12** - A valid batch is answered `202` with no content and forwarded unchanged with the backend credentials (OBS-10, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int.test.ts -t "a valid batch is answered 202 with no content and forwarded once"`

**C13** - A request with no credential gets `401` and nothing is forwarded (OBS-11, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http/guards.test.ts -t "no credential gets 401"`

**C14** - The agent's observation leaves its own trace, with the heartbeat and stream API spans as children of the agent's spans (OBS-12, AC 12)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The agent's observation leaves its own trace"`

**C15** - A body of 1 MiB plus one byte gets `413` and nothing is forwarded (OBS-13, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int.test.ts -t "a body of 1 MiB plus one byte gets 413 and nothing is forwarded"`

**C16** - The sixty-first request in a minute gets `429` and the sixtieth is accepted (OBS-14, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-budget.test.ts -t "refuses the sixty-first request in a minute"`

**C17** - The 121st credential-less request from one address in a minute gets `429` (OBS-14, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-limiter.test.ts -t "counts credential-less requests per address and refuses the 121st"`

**C18** - A valid agent is accepted while the address bucket is full (OBS-14, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-order.int.test.ts -t "a valid agent is accepted while the address bucket is full"`

**C19** - A backend failure never changes the relay's `202` and logs one warning without the body (OBS-15, AC 8)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-forwarder.test.ts -t "a redirect is refused and a failure is logged once without credentials"`

**C20** - The relay returns no backend header or body and no log or span holds the credentials (OBS-16, AC 9)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-order.int.test.ts -t "returns no backend header or body and logs no credentials"`

**C21** - A session whose origin is missing, wrong, slash-suffixed or a subdomain gets `403` (OBS-17, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http/guards.test.ts -t "a missing, wrong, slash-suffixed or subdomain origin gets 403"`

**C22** - A full queue of 2048 spans drops the oldest (OBS-18, AC 10)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(a_full_queue_of_2048_drops_the_oldest_span)'`

**C23** - `401`, `403`, `413` and `415` drop the batch (OBS-19, AC 11)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(status_401_403_413_415_drop_the_batch)'`

**C24** - `429` waits for `Retry-After`, capped at one hour (OBS-19, AC 11)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(status_429_waits_for_retry_after_capped_at_one_hour)'`

**C25** - A slow relay never delays a caller (OBS-19, AC 11)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(a_slow_relay_never_delays_a_caller)'`

**C26** - The relay checks the rate before the content type and the content type before the size (OBS-20, AC 5 and 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-order.int.test.ts -t "the relay applies its checks in order"`

**C27** - A content encoding other than `identity` gets `415` (OBS-20, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int.test.ts -t "content-encoding other than identity gets 415"`

**C28** - The site exporter targets the relay path and sends nothing unless enabled (OBS-21, AC 13)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "exporter targets the relay path"`

**C29** - The domain and core manifests hold no OpenTelemetry crate and the exporter lives in adapters (OBS-22, AC 14)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain and core manifests hold no tracing or OpenTelemetry crate and the exporter lives in adapters" scripts/test/agent-architecture.test.mjs`

**C30** - The compose file pins the image tag and digest and `package.json` defines `obs:up` and `obs:down` (OBS-23, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="compose pins the image tag and digest and binds loopback" scripts/test/observability-infra.test.mjs`

**C31** - The scripts `obs:up` and `obs:down` exist (OBS-23, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="package.json defines obs:up and obs:down" scripts/test/observability-infra.test.mjs`

**C32** - The trace scenarios read both traces back from the backend and print their ids (OBS-24, AC 2 and 3)
Proof: `pnpm --filter @d2rmm/acceptance exec vitest run support/trace-reader.test.ts -t "prints both trace ids"`

**C33** - Without Docker the backend step fails naming Docker (OBS-25, AC 4)
Proof: `pnpm --filter @d2rmm/acceptance exec vitest run support/telemetry-backend.test.ts -t "fails naming Docker when the socket is absent"`

**C34** - A log line inside a span carries `trace_id` and `span_id`, none outside (OBS-26, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/main/app.test.ts -t "log line inside a span carries trace_id and span_id and none outside"`

**C35** - The API exports a log record with the trace id over OTLP (OBS-27, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.test.ts -t "exports a log record with the trace id"`

**C36** - Every forbidden key is stripped and the allowed keys stay (OBS-28, AC 3)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/redact-attributes.test.ts -t "strips every forbidden key and keeps the allowed ones"`

**C37** - Exception message and stacktrace are removed from span events (OBS-28, AC 3)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/redacting-exporters.test.ts -t "removes exception message and stacktrace from span events"`

**C38** - The query string and fragment are removed from URL attributes and the client address is dropped (OBS-29, AC 4)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/redact-attributes.test.ts -t "removes the query string and the fragment from url attributes and drops the client address"`

**C39** - The standardized `d2r.*` constants are exported (OBS-30, AC 5)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/attributes.test.ts -t "exports the standardized d2r attribute constants"`

**C40** - No lobby or matchmaking span carries an account or agent id (OBS-30, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "no span of lobby or matchmaking carries an account or agent id and the room id uses the d2r constant"`

**C41** - Metric attributes are limited to the bounded sets (OBS-31, AC 6)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/views.test.ts -t "metric attributes are limited to the bounded sets"`

**C42** - Every exported resource carries service name, version and environment (OBS-32, AC 7)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/resource.test.ts -t "carries service name, version and environment"`

**C43** - The agent's resource carries `d2r.agent.version` (OBS-32, AC 7)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(agent_resource_carries_the_agent_version)'`

**C44** - Request duration and body size are recorded by route template and status class (OBS-33, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/request-metrics.int.test.ts -t "records request duration and body size by route template and status class"`

**C45** - `sse.connections` goes up and down with the connection (OBS-33, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/stream-hub.int.test.ts -t "sse.connections goes up and down with the connection"`

**C46** - `outbox.lag` is the age of the oldest unpublished row and 0 when none (OBS-33, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-lag.int.test.ts -t "outbox.lag is the age of the oldest unpublished row and 0 when none"`

**C47** - `room.stage_duration` is recorded once with the seconds since the room opened (OBS-34, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "records room.stage_duration once with the seconds since the room opened"`

**C48** - The dashboard holds the listed panels (OBS-35, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the dashboard holds the listed panels" scripts/test/observability-infra.test.mjs`

**C49** - Compose provisions the dashboard (OBS-35, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="compose provisions the dashboard" scripts/test/observability-infra.test.mjs`

**C50** - Every metric a dashboard panel queries is defined by the code (OBS-36, AC 4)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/dashboard-metrics.test.ts -t "every dashboard metric is defined by the code"`

**C51** - Against a closed port every request is answered as with a reachable backend and at most one export error a minute is logged (OBS-37, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-order.int.test.ts -t "answers identically against a closed port"`

**C52** - The agent keeps its loops running when the relay is unreachable (OBS-38, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(the_loops_keep_running_when_the_relay_is_unreachable)'`

**C53** - `process.env` in the telemetry package is a lint error (OBS-39, AC 3)
Proof: `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports process.env in the telemetry package"`

**C54** - `.env.example` lists every `OTEL_*` variable the config reads (OBS-40, AC 4)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern=".env.example lists every OTEL variable the config reads" scripts/test/env-example.test.mjs`

**C55** - An application file importing the telemetry node entry fails the architecture rule (OBS-41, AC 5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="an application file importing the telemetry node entry fails" scripts/test/telemetry-rules.test.mjs`

**C56** - `openapi.json` documents `/v1/telemetry/traces` (OBS-42, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/openapi.int.test.ts -t "openapi documents the telemetry relay"`

**C57** - The sampler takes the ratio from the variable, `0.1` when unset, and a local child follows its parent (OBS-43, AC 7)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts -t "ratio from the variable and 0.1 when unset"`

**C58** - A forced sampled flag cannot export more than the cap (OBS-43, AC 7; AD-100)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts -t "a forced sampled flag cannot exceed the cap"`

**C59** - The web build creates no exporter unless `VITE_TELEMETRY` is `on` (OBS-44, AC 8)
Proof: `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "no exporter is created unless enabled"`

**C60** - The relay refuses without a repository call when the lookup bucket is empty and a cache hit never takes a token (OBS-11, OBS-14; AD-097)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/application/authenticate-agent.test.ts -t "a miss with beforeLookup false returns throttled without a repository call"`

**C61** - The release and deploy workflows leave the telemetry flags unset (OBS-44; AD-098)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release and deploy workflows leave VITE_TELEMETRY and D2RMM_TELEMETRY unset" scripts/test/telemetry-flags.test.mjs`

**C62** - The agent's sampler decisions match the shared vector (OBS-43; AD-100)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(sampler_decisions_match_the_shared_vector)'`

**C63** - The agent drops window title, process path, screen text, URLs and event paths before export (OBS-28, OBS-30)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(drops_window_title_process_path_screen_text_urls_events_with_paths_and_status_text)'`

**C64** - The `fixture-read` feature is never a default feature in either manifest (OBS-24; AD-096)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="fixture-read is never a default feature in either manifest" scripts/test/agent-source-rules.test.mjs`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-1 (T1 to T11) returned complete (two redispatches after the T8 reset and the T10 clarification); execute-batch-2 (T12 to T21, feature-worker) at HEAD ecf3c65, returned blocked at T12 on the .env.example permission; execute-batch-2 again (T12 to T21) at HEAD 7771239, not yet returned
**Walked:** none
**Carried into batch 2:** T9's `startNodeTelemetry` returns `tracerProvider`, `meterProvider`, `loggerProvider` and `shutdown` and registers no globals, so T13 registers them. The T11 cruiser fixture imports the telemetry node entry by relative path; T13 wires the real `@d2rmm/telemetry/node` import and must show `pnpm arch` (through the wrapper) still fails an `application` file that imports that specifier. T16 creates its histograms on the meter named `d2rmm` (`APP_METER_NAME` in `packages/telemetry/src/sdk/views.ts`). The samplers use the Rust ratio rule (AD-102).

**T10 clarification (orchestrator, 2026-11-02):** `packages/config/test/presets.test.ts` pins the exact list of repository ESLint blocks with `toStrictEqual`, so T10's new block for `packages/telemetry/src/**` must be added to that list, verbatim and in the same position, in the same commit; equality stays strict and nothing is loosened. This is part of extending the sensor under `harness-edits` (the `apps/api` block was added the same way), not a replan. If the gate hook refuses that one edit, stop and report.

**Blocked:** `gate:observability-e2e/T8` used its 3 attempts (exit 3). execute-batch-1 stopped at T8; T9 to T11 not started (T9 depends on T8). T1 to T7 are committed (see the commit log); T8 is not committed and its files are left in the worktree as they were at the third attempt. Last error (attempt 3): `views.test.ts:64`, `drops the HTTP instrumentation duration histogram and keeps the application one by route and status class` expected 1 metric named `http.server.request.duration`, got 2. Attempts: (1) `tsc` TS2375 on `attributesProcessors: ... | undefined` under `exactOptionalPropertyTypes`, fixed by typing the helper `IAttributesProcessor[]`; (2) the same length failure, no code change; (3) collected the exports before `provider.shutdown()` on the hypothesis that shutdown adds a second export, still 2. A standalone run of the same `boundedMetricViews()` and the same two recordings (outside the gate, deleted afterwards) exports one metric with one data point, so the cause is in the test run, not in the views module. Not yet explained; the orchestrator should replan T8's test.
**Reset and resolved (execute-batch-1, after the maintainer's reset of `gate:observability-e2e/T8`):** T8 passed on its first attempt of the new budget with the views test collecting through a non-exporting `MetricReader` and `reader.collect()`; both assertions unchanged (commit 4a0bb06). T9 passed on its second attempt (commit df693b3; attempt 1 failed because `BatchSpanProcessor.forceFlush()` rejects with the export error, fixed in the test and the handle's `shutdown()`).
**Blocked at T10 (execute-batch-1, plan conflict, not a retry exhaustion):** `packages/config/test/presets.test.ts`, test `eslint keeps every repository rule, ignore and override unchanged`, pins the exact list of repository blocks with `toStrictEqual`. T10 adds one block for `packages/telemetry/src/**` (the tightening the task asks for), so that expectation fails (attempt 1 of 3, gate `pnpm --filter @d2rmm/config test`). Passing it needs an edit to that expectation, which the rules forbid without a replan. The new fixture test `reports process.env in the telemetry package` passes with the block. Uncommitted in the worktree: `packages/config/eslint.mjs` (the block) and `packages/config/test/rules.test.ts` (the fixture test). T11 depends on T10 and did not start.
**Batch plan (this line wins over the batch line of the Execution Plan, which mislabels phases):** whole phases packed to about 7 tasks. execute-batch-1 = Phases 1 and 2 (T1 to T11), execute-batch-2 = Phases 3 and 4 (T12 to T21), execute-batch-3 = Phases 5 and 6 (T22 to T30), execute-batch-4 = Phases 7 and 8 (T31 to T37), execute-batch-5 = Phases 9 and 10 (T38 to T46), execute-batch-6 = Phases 11 and 12 (T47 to T56). Batches 7 to 9 are kept for the Verifier's findings.
**Blocked at T12 (execute-batch-2, permission, not a retry exhaustion):** `.env.example` cannot be created. The maintainer's `.claude/settings.json` denies `Read(./.env.*)`, which matches `.env.example`, and the Write tool refused the file with "covered by a Read deny rule". The config half of T12 is done and its gate passed (`gate:observability-e2e/T12`, attempt 1: typecheck clean, 250 unit tests). Uncommitted in the worktree: `apps/api/src/main/config.ts`, `apps/api/src/main/config.test.ts`, `scripts/test/env-example.test.mjs`. Missing: `.env.example` at the repo root, which the harness test `.env.example lists every OTEL variable the config reads` needs. The content is four `OTEL_*` lines with placeholders (endpoint `http://127.0.0.1:4318`, headers `authorization=placeholder-replace-me`, sampler `0.1`, interval `60000`). Resolving the conflict between the deny rule and CLAUDE.md's `.env.example` exception is a maintainer decision. T13 to T21 not started, because T13 depends on T12.
**Pinned versions and spike results:**

- T1 (registry read 2026-11-02, exact pins in `packages/telemetry/package.json`): `@opentelemetry/api` 1.9.1, `core` 2.12.0, `resources` 2.12.0, `sdk-trace-base` 2.12.0, `sdk-metrics` 2.12.0, `sdk-trace-web` 2.12.0, `sdk-logs` 0.223.0, `exporter-trace-otlp-http` 0.223.0, `exporter-metrics-otlp-http` 0.223.0, `exporter-logs-otlp-http` 0.223.0, `semantic-conventions` 1.44.0; dev `@types/node` ^26.6.6.
- The registry latest is the 3.0.0 line (`core`, `resources`, `sdk-metrics`, `sdk-logs` 3.0.0), whose api peer is `>=1.10.0 <1.11.0`. `sdk-trace-base` and `sdk-trace-web` have no 3.x release (latest 2.12.0, api peer `<1.10`), so the 2.x line with api 1.9.1 is the only coherent set. Rejected: api 1.10.0 and the 3.x line.
- Registry notice: `sdk-trace-base` 2.12.0 and `sdk-trace-web` 2.12.0 are marked deprecated, "Use @opentelemetry/sdk-trace package". Kept as the design names them; the replacement is a maintainer decision (recorded in the T1 report, not in `decisions.md`).
- T5 deviation: the TypeScript sampler implements the Rust rule (`lower 8 bytes >> 1 < floor(ratio * 2^63)`, as in `opentelemetry_sdk` 0.33.1 `sample_based_on_probability`), not `TraceIdRatioBased` from `sdk-trace-base` 2.12.0, which compares an XOR of the four 32-bit words of the trace id. The two rules disagree on the same trace id, so the shared vector `packages/telemetry/test-vectors/sampler.json` (generated from the Rust rule, outside the repo) cannot hold for both through the library class. T41 must use `Sampler::TraceIdRatioBased` as it is.
- T8 deviation: `@opentelemetry/sdk-metrics` 2.12.0 has no `attributeKeys` option; the bounded keys go through `attributesProcessors` with `createAllowListAttributesProcessor`. The two HTTP histograms are scoped to `APP_METER_NAME` (`d2rmm`), so the drop view for `@opentelemetry/instrumentation-http` removes only the instrumentation's series (AD-095). T16 must create its histograms on `APP_METER_NAME`.
- T9 (execute-batch-1, attempt 2 of the reset budget): `startNodeTelemetry` returns `tracerProvider`, `meterProvider`, `loggerProvider` and `shutdown`, and registers no global provider (T13 registers them). `sdk-trace-base` 2.12.0 is a shim over `@opentelemetry/sdk-trace` 2.12.0, and its `BatchSpanProcessor.forceFlush()` rejects with the export error (reported at most once a minute through `onExportError`); the handle's `shutdown()` does not rethrow it. The OTLP exporters of 0.223.0 have no redirect option, so the redirect clause holds by construction. The options take an optional `now` clock in addition to the design's list.
- T9, T13, T38 to T43, T47 write here.

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12

Phase 1:  T1 → T2 → T3 → T4 → T5 → T6
Phase 2:  T7 → T8 → T9 → T10 → T11
Phase 3:  T12 → T13 → T14 → T15 → T16
Phase 4:  T17 → T18 → T19 → T20 → T21
Phase 5:  T22 → T23 → T24 → T25
Phase 6:  T26 → T27 → T28 → T29 → T30
Phase 7:  T31 → T32 → T33
Phase 8:  T34 → T35 → T36 → T37
Phase 9:  T38 → T39 → T40 → T41 → T42 → T43
Phase 10: T44 → T45 → T46
Phase 11: T47 → T48 → T49
Phase 12: T50 → T51 → T52 → T53 → T54 → T55 → T56
```

Execution is strictly sequential within a feature; the first task of each phase depends on the last task of the one before.
