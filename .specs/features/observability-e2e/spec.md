# Observability End to End Specification

**Approved**: [written when the gates pass - YYYY-MM-DD - user: "kickoff words" (delegated via .specs/phases/F0/brief.md)]

## Problem Statement

Spans already exist in the API (`withSpan`, one per use case) and in the agent (six loop spans, six `agent.http.*` spans,
`traceparent` on every request), but nothing is exported: `packages/telemetry` is empty, the API and the site run no
OpenTelemetry SDK, nothing stores the trace across the outbox, and there is no backend to look at. NFR-09 and the F0 exit
criterion ask for one trace from the site click through the API, Postgres, the outbox and the SSE event, with the agent's
spans linked by `traceparent`, visible in a telemetry backend. This feature turns the existing spans into that trace and
proves it against a local backend.

## Goals

- [ ] One trace id contains the site click, the API request, a Postgres span, the outbox relay and the stream delivery,
      and the agent's heartbeat and observation requests continue the agent's trace (NFR-09, ADR 013).
- [ ] The site and the agent send OTLP to a relay on the API, which holds the backend credentials; the API exports to the
      backend named only by `OTEL_EXPORTER_OTLP_*` in `main/` (ADR 013).
- [ ] Logs carry the trace id, and no token, cookie, code, image or player name reaches a span, a metric or a log.
- [ ] The skeleton's metrics and one dashboard exist as code, and an acceptance scenario reads the trace back from a
      local `grafana/otel-lgtm` (design doc, "No dia a dia").

## Out of Scope

| Feature                                                                                                                                  | Reason                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Grafana Cloud account, its endpoint and `OTEL_EXPORTER_OTLP_HEADERS` secret                                                              | Maintainer decision (2026-11-02): the F0 proof is local; agents never create secrets (AGENTS.md rule 6)   |
| Domain metrics of features that do not exist yet (`queue.wait_time`, `ready_check.outcome`, `match.dispute_rate`, `room.member.dropped`) | Their use cases arrive in F1; instruments are created with the use case                                   |
| `agent.read_rate` and any agent metric                                                                                                   | The agent reads a fixture in F0 (AGS-33); real reads and the metric are F2                                |
| A span on the site for the arrival of an SSE event                                                                                       | The SSE payload would need a trace field: a contract change; the server-side delivery span covers the hop |
| SLOs and error-budget alerts, deploy and release markers, the OpenTelemetry Collector with tail sampling                                 | Design doc lists them as operations after the free tier; none is an F0 exit criterion                     |
| Dashboards beyond one skeleton dashboard                                                                                                 | The funnel, wait heat map and read-rate panels need F1/F2 metrics                                         |
| Egress bytes per player-hour and Neon CU metrics                                                                                         | `load-baseline` publishes bytes per player-hour (NFR-14); Neon CU comes from the provider                 |
| Changing any existing route, event or message                                                                                            | Contracts first: the only contract change is the new relay route (OBS-27)                                 |

---

## Assumptions & Open Questions

| Assumption / decision              | Chosen default                                                                                                                                                                                                                                   | Rationale                                                                                            | Confirmed? |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------- |
| Telemetry backend for the F0 proof | Local `grafana/otel-lgtm` in Docker; production configuration is environment only, with no secret in the repository                                                                                                                              | Maintainer answered "yes" to local-only and to Docker (2026-11-02)                                   | y          |
| Wire format of the relay           | `POST /v1/telemetry/traces`, body OTLP/HTTP (`application/x-protobuf` or `application/json`), forwarded to the backend unchanged apart from the credentials the API adds                                                                         | The agent and the browser SDK both speak OTLP/HTTP; no parsing means no new schema to maintain       | n          |
| Who may call the relay             | A bearer agent token or a signed-in site session; nobody else                                                                                                                                                                                    | The relay is a public write path to the maintainer's quota; the credentials already exist (AWS, AGS) | n          |
| Relay limits                       | 1 MiB per request, 60 requests per minute per principal, answered `413` and `429` with `Retry-After`                                                                                                                                             | Bounded abuse surface on a single free instance (ADR 006); numbers are conservative                  | n          |
| How the SSE hop joins the trace    | The server-side span `platform.stream.deliver` is a child of the trace stored with the outbox row; the browser does not report receipt                                                                                                           | `EventSource` cannot read a trace field without changing the event payload (contract change)         | n          |
| How the outbox keeps the trace     | A nullable column `trace_context` (W3C `traceparent` text) on `platform.outbox`, written in the transaction that writes the event; the relay opens a span that continues it                                                                      | The outbox is the only async hop; it needs the context persisted, there is no other carrier          | n          |
| Sampling                           | Parent-based, ratio from `OTEL_TRACES_SAMPLER_ARG` (default `1.0`)                                                                                                                                                                               | F0 volume is tiny and the proof needs every trace; the ratio is a setting for later                  | n          |
| Metrics created in F0              | `http.server.response.body.size`, `sse.connections`, `outbox.lag`, `room.stage_duration`                                                                                                                                                         | They are the instruments whose subject exists in the skeleton; the others wait for their use case    | n          |
| Site telemetry switch              | On by default in the web build; `VITE_TELEMETRY=off` disables it                                                                                                                                                                                 | The exit criterion needs the click in the trace; an off switch keeps previews and tests quiet        | n          |
| Span attribute names               | The standardized `d2r.*` attributes of the design doc are constants in `packages/telemetry`; the camelCase ids the use cases set today (`agentId`, `roomId`) are renamed to them where one exists and dropped where it would carry an account id | The design doc fixes the names; PRD forbids BattleTag and character names in telemetry               | n          |
| Name of the use-case spans         | Unchanged (`lobby.record-observation`, `matchmaking.form-test-match`, …)                                                                                                                                                                         | Already shipped and tested (AWS-35); the design doc's `lobby.observe` is a draft name                | n          |
| Docker in CI                       | The acceptance job already runs Testcontainers; the trace scenario runs there with the same Docker                                                                                                                                               | `tests/acceptance` stack uses Testcontainers Postgres today                                          | n          |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: One trace from the click to the stream event ⭐ MVP

**User Story**: As the maintainer, I want one trace to follow a player's action from the site through the API, Postgres,
the outbox and the stream so that I can see where time goes and prove the pipeline works end to end.

**Why P1**: F0 exit criterion "One trace: site click → API → Postgres → outbox → SSE" (NFR-09).

**Acceptance Criteria**:

1. WHEN the API starts with `OTEL_EXPORTER_OTLP_ENDPOINT` set THEN it SHALL install an OpenTelemetry SDK in `main/` that exports traces and metrics to that endpoint over OTLP/HTTP; WHEN the variable is unset THEN it SHALL start without exporting and without an error.
2. The API SHALL instrument its HTTP server, Fastify routes and `pg` queries, so that each request produces a server span and each query a child span of it.
3. WHEN the site calls the API THEN it SHALL send a `traceparent` header on that request and open a span for the action and for each navigation.
4. WHEN a use case commits an outbox event THEN the API SHALL store the W3C `traceparent` of the active span in the new nullable column `trace_context` in the same transaction.
5. WHEN the outbox relay publishes an event with a stored `trace_context` THEN it SHALL open the span `platform.outbox.relay` as a child of that context, and SHALL open `platform.stream.deliver` as its child for each stream connection that receives the event.
6. WHEN a signed-in player starts a test match from the site and the host's agent reports the game name THEN one trace id SHALL contain the site action span, the API request span, at least one `pg` span, `platform.outbox.relay` and `platform.stream.deliver`.
7. IF an outbox row has no `trace_context` THEN the relay SHALL publish it and open a new root span, and SHALL NOT fail.

**Independent Test**: start the stack with the local backend, run the scenario, and read the trace by id from Tempo.

---

### P1: The agent and the site export through a relay ⭐ MVP

**User Story**: As the maintainer, I want the site and the agent to send their spans to the API, which holds the backend
credentials, so that no secret is shipped in a browser bundle or an installer and the backend can be swapped by
configuration (ADR 013).

**Why P1**: the design doc routes site and agent OTLP through a relay; the agent's spans must reach the backend for the trace to exist.

**Acceptance Criteria**:

1. WHEN an agent with a valid token or a signed-in site session sends `POST /v1/telemetry/traces` with an OTLP body of at most 1 MiB and content type `application/x-protobuf` or `application/json` THEN the API SHALL answer `202` with an empty body and forward the body unchanged to the configured backend with its credentials.
2. IF the request has neither a valid agent token nor a valid session THEN the API SHALL answer `401` and forward nothing.
3. IF the content type is not one of the two accepted THEN the API SHALL answer `415`; IF the body is larger than 1 MiB THEN it SHALL answer `413`; in both cases it SHALL forward nothing.
4. IF a principal sends more than 60 relay requests in a minute THEN the API SHALL answer `429` with `Retry-After` and forward nothing.
5. IF the backend is unreachable or answers an error THEN the relay SHALL still answer `202`, SHALL log one warning without the body, and SHALL NOT retry.
6. The relay SHALL NOT return a header or a body from the backend, and the backend credentials SHALL NOT appear in a response, a log or a span.
7. The agent SHALL export its spans as OTLP/HTTP to the relay on the API base it already uses, from a bounded queue of 2048 spans that drops the oldest span when full and never blocks a loop, a request or the UI.
8. WHEN the agent sends a heartbeat, an observation or opens the stream THEN the API's server span for that request SHALL be a child of the agent's `agent.http.*` span, with the same trace id.
9. The site SHALL export its spans through the same relay with the same limits.
10. The agent's domain crate SHALL NOT depend on any tracing or OpenTelemetry crate, and the exporter SHALL live in the adapters crate.

**Independent Test**: post an OTLP fixture with and without a token; run the agent's gateway against the fake API and see the exported body arrive at the relay.

---

### P1: A local backend and an end-to-end proof ⭐ MVP

**User Story**: As a maintainer, I want a backend I can start with one command and a test that reads the trace back so
that "the trace exists" is checked by code, not by eye.

**Why P1**: the design doc says the end-to-end tests verify that a complete trace was produced.

**Acceptance Criteria**:

1. The repository SHALL contain `infra/observability/compose.yaml` that starts `grafana/otel-lgtm` pinned to an image tag, and `pnpm obs:up` and `pnpm obs:down` SHALL start and stop it.
2. WHEN the acceptance scenario for the trace runs THEN it SHALL start the API with its OTLP endpoint pointing at that backend, drive the site flow and the agent over its HTTP contract, and SHALL poll Tempo for the trace id for at most 30 s.
3. WHEN the trace is found THEN the scenario SHALL assert the span names of OBS-06 and the agent-linked server spans of OBS-11, and SHALL print the trace id.
4. IF Docker is unavailable THEN the scenario SHALL fail with a message that names Docker as the missing prerequisite, and SHALL NOT pass without having read a trace; the scenario carries the tag `@slow`.

**Independent Test**: `pnpm test:acceptance -- --grep @OBS-06`.

---

### P1: Telemetry that cannot leak ⭐ MVP

**User Story**: As a player and a maintainer, I want telemetry free of secrets and personal data so that exporting it
to a third-party backend is safe (ADR 013, NFR-04).

**Why P1**: PRD and ADR 013: attributes free of secrets and PII; the relay widens the surface.

**Acceptance Criteria**:

1. API logs SHALL be JSON lines carrying `trace_id` and `span_id` of the active span when there is one.
2. The telemetry package SHALL strip from every span, metric and log record any attribute whose key matches `authorization`, `cookie`, `set-cookie`, `token`, `code`, `secret`, `password`, `image` or `battletag` (case-insensitive), before export.
3. The standardized attributes (`d2r.room.id`, `d2r.queue.mode`, `d2r.difficulty`, `d2r.ladder`, `d2r.era`, `d2r.agent.version`) SHALL be exported as constants from `packages/telemetry`; no span SHALL carry a BattleTag, a character name or an account id.
4. Metric attributes SHALL be limited to bounded sets (route template, status class, room stage, difficulty, mode), never an id.
5. Every exported resource SHALL carry `service.name` (`d2rmm-web`, `d2rmm-api` or `d2rmm-agent`), `service.version` and `deployment.environment`; the agent's SHALL also carry `d2r.agent.version`.

**Independent Test**: unit tests over the redaction processor with a fixture span holding each forbidden key; a scan of every span exported during the trace scenario.

---

### P1: Metrics and one dashboard as code ⭐ MVP

**User Story**: As the maintainer, I want the skeleton's few metrics and a dashboard in the repository so that the
telemetry has a reader from day 0.

**Why P1**: NFR-09 asks for metrics from day 0; the design doc keeps dashboards as code in `infra/observability/`.

**Acceptance Criteria**:

1. The API SHALL record `http.server.response.body.size` (histogram, by route template and status class), `sse.connections` (up-down counter, by stream kind), `outbox.lag` (gauge in seconds, the age of the oldest unpublished row, 0 when none) and `room.stage_duration` (histogram in seconds, by stage).
2. WHEN a room reaches `created` THEN the API SHALL record `room.stage_duration` for the stage it left.
3. `infra/observability/dashboards/skeleton.json` SHALL hold a Grafana dashboard with request rate, error rate and duration per route, `outbox.lag` and `sse.connections`, and the compose file SHALL provision it.
4. A test SHALL fail if a panel of the dashboard queries a metric that the code does not define.

**Independent Test**: a unit test lists the instruments and the dashboard's queries and compares them.

---

### P2: Telemetry never hurts the product

**User Story**: As a player, I want the product to work the same when the telemetry backend is down or not configured.

**Why P2**: observability must not become a dependency; it is a robustness rule rather than an exit criterion.

**Acceptance Criteria**:

1. IF the telemetry endpoint is unreachable THEN the API SHALL answer every request exactly as when it is reachable, and SHALL log at most one export error per minute.
2. IF the agent's relay is unreachable THEN the agent SHALL keep pairing, beating, reading and posting, and SHALL log at most one export error per minute.
3. The exporter settings SHALL be read only in `main/` (API) and in the composition root (agent); `packages/telemetry` SHALL take them as arguments and SHALL NOT read `process.env`.
4. The repository SHALL contain `.env.example` with every `OTEL_*` variable the API reads and placeholder values only.
5. Use-case spans SHALL stay in the application layer and the domain SHALL emit none.
6. The relay route SHALL be in `openapi.json`, regenerated by `pnpm contracts:openapi`.

**Independent Test**: start the API pointing at a closed port and run the API integration suite; `pnpm lint` fails on a `process.env` fixture in the telemetry package.

---

## Edge Cases

- WHEN the site is open in two tabs THEN each tab SHALL start its own trace per action; nothing joins them (follows from OBS-03).
- WHEN an agent token is revoked while the exporter holds queued spans THEN the next relay request SHALL be answered `401` and the exporter SHALL drop that batch (OBS-09, OBS-15).
- WHEN a trace is partly sampled out THEN the child spans SHALL follow the parent's decision (the Sampling row of the assumptions; parent-based sampler, OBS-01).

---

## Requirement Traceability

| Requirement ID | Story                                                     | Phase  | Status  |
| -------------- | --------------------------------------------------------- | ------ | ------- |
| OBS-01         | P1: One trace from the click to the stream event (AC 1)   | Design | Pending |
| OBS-02         | P1: One trace from the click to the stream event (AC 2)   | Design | Pending |
| OBS-03         | P1: One trace from the click to the stream event (AC 3)   | Design | Pending |
| OBS-04         | P1: One trace from the click to the stream event (AC 4)   | Design | Pending |
| OBS-05         | P1: One trace from the click to the stream event (AC 5)   | Design | Pending |
| OBS-06         | P1: One trace from the click to the stream event (AC 6)   | Design | Pending |
| OBS-07         | P1: One trace from the click to the stream event (AC 7)   | Design | Pending |
| OBS-08         | P1: The agent and the site export through a relay (AC 1)  | Design | Pending |
| OBS-09         | P1: The agent and the site export through a relay (AC 2)  | Design | Pending |
| OBS-10         | P1: The agent and the site export through a relay (AC 3)  | Design | Pending |
| OBS-11         | P1: The agent and the site export through a relay (AC 8)  | Design | Pending |
| OBS-12         | P1: The agent and the site export through a relay (AC 4)  | Design | Pending |
| OBS-13         | P1: The agent and the site export through a relay (AC 5)  | Design | Pending |
| OBS-14         | P1: The agent and the site export through a relay (AC 6)  | Design | Pending |
| OBS-15         | P1: The agent and the site export through a relay (AC 7)  | Design | Pending |
| OBS-16         | P1: The agent and the site export through a relay (AC 9)  | Design | Pending |
| OBS-17         | P1: The agent and the site export through a relay (AC 10) | Design | Pending |
| OBS-18         | P1: A local backend and an end-to-end proof (AC 1)        | Design | Pending |
| OBS-19         | P1: A local backend and an end-to-end proof (AC 2-3)      | Design | Pending |
| OBS-20         | P1: A local backend and an end-to-end proof (AC 4)        | Design | Pending |
| OBS-21         | P1: Telemetry that cannot leak (AC 1)                     | Design | Pending |
| OBS-22         | P1: Telemetry that cannot leak (AC 2)                     | Design | Pending |
| OBS-23         | P1: Telemetry that cannot leak (AC 3-4)                   | Design | Pending |
| OBS-24         | P1: Telemetry that cannot leak (AC 5)                     | Design | Pending |
| OBS-25         | P1: Metrics and one dashboard as code (AC 1-2)            | Design | Pending |
| OBS-26         | P1: Metrics and one dashboard as code (AC 3-4)            | Design | Pending |
| OBS-27         | P2: Telemetry never hurts the product (AC 6)              | Design | Pending |
| OBS-28         | P2: Telemetry never hurts the product (AC 1-2)            | Design | Pending |
| OBS-29         | P2: Telemetry never hurts the product (AC 3-5)            | Design | Pending |

---

## Sources

- `docs/product/prd.md#NFR-09` - traces, metrics and logs in OpenTelemetry from day 0, in the three apps → OBS-01…OBS-07, OBS-21…OBS-29
- `docs/product/prd.md#NFR-04` - nothing sensitive stored or exported beyond need → OBS-22, OBS-23
- ADR 013 (OpenTelemetry to a swappable backend) - OTLP, backend configured only in `main/`, `traceparent` link, no secrets or PII in attributes → OBS-01, OBS-08…OBS-17, OBS-22, OBS-29
- ADR 010 (read-only agent) - the agent sends data only; the relay answers an empty `202`, never a command → OBS-08, OBS-17
- ADR 006 (single instance, no queue service) - the relay forwards synchronously with bounded limits → OBS-10, OBS-12
- ADR 003 and ADR 027 (hexagonal layers) - spans in the application, exporter in the adapters, none in the domain → OBS-17, OBS-29
- `docs/architecture/design-doc.md` § Observabilidade com OpenTelemetry - relay, instrumentation, standard attributes, metrics table, dashboards as code, `grafana/otel-lgtm` → all
- `docs/engineering/telemetry.md` - span naming `<context>.<use-case>`, bounded cardinality, no ids on metrics, JSON logs with trace id → OBS-21, OBS-24, OBS-25
- `.specs/features/api-web-skeleton/spec.md` (AWS-35, AWS-31) - the use-case spans and the `process.env` rule this feature builds on → OBS-01, OBS-29
- `.specs/features/agent-skeleton/spec.md` (AGS-12, AGS-33) - the agent's spans, `traceparent`, and the `fixture-read` feature for the end-to-end run → OBS-11, OBS-15, OBS-19
- `.specs/features/agent-hexagonal-migration/spec.md` (AHM-18) - where the agent's telemetry lives → OBS-17
- `.specs/phases/F0/brief.md` - exit criteria "One trace…" and "Pairing by code and heartbeat end to end - proof: e2e test + trace" → OBS-06, OBS-19
- AD-084…AD-088 (assumed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] `pnpm test:acceptance -- --grep @OBS-06` finds one trace in Tempo that holds the site action, the API request, a `pg` span, `platform.outbox.relay`, `platform.stream.deliver` and the agent-linked server spans.
- [ ] Posting to the relay without credentials, with a wrong content type, over 1 MiB, or past 60 requests a minute is refused with `401`, `415`, `413` and `429`, and nothing reaches the backend.
- [ ] No exported span, metric or log record in the trace scenario holds a forbidden key or a player name.
- [ ] `pnpm check` and `pnpm contracts:openapi` leave no drift; `pnpm obs:up` starts the local backend with the skeleton dashboard.
