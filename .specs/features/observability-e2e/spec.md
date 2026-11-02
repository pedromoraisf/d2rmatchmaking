# Observability End to End Specification

**Approved**: [written when the gates pass - YYYY-MM-DD - user: "kickoff words" (delegated via .specs/phases/F0/brief.md)]

## Problem Statement

Spans already exist in the API (`withSpan`, one per use case) and in the agent (six loop spans, six `agent.http.*` spans,
`traceparent` on every request), but nothing is exported: `packages/telemetry` is empty, the API and the site run no
OpenTelemetry SDK, nothing stores the trace across the outbox, and there is no backend to look at. NFR-09 and the F0 exit
criterion ask for a trace from the site click through the API, Postgres, the outbox and the SSE event, with the agent's
spans linked by `traceparent`, visible in a telemetry backend. This feature turns the existing spans into those traces
and proves them against a local backend (AD-088: the maintainer chose a local backend over the brief's Grafana link).

## Goals

- [ ] One trace holds the site action, the API request, a Postgres span, the outbox relay and the stream delivery of
      the room being formed, and a second trace holds the agent's observation, the API spans it parents, the outbox
      relay and the stream delivery of the room becoming `created` (NFR-09, ADR 013, AD-092).
- [ ] The site and the agent send OTLP to a relay on the API, which holds the backend credentials; the API exports to
      the backend named only by `OTEL_EXPORTER_OTLP_*` in `main/` (ADR 013).
- [ ] The API's logs carry the trace id and are exported with traces and metrics; no token, cookie, code, query string,
      image or player name reaches a span, a metric or a log.
- [ ] The skeleton's metrics and one dashboard exist as code, and an acceptance scenario reads the traces back from a
      local `grafana/otel-lgtm` (design doc, "No dia a dia").

## Out of Scope

| Feature                                                                                                                                  | Reason                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Grafana Cloud account, its endpoint and the `OTEL_EXPORTER_OTLP_HEADERS` secret                                                          | Maintainer decision (2026-11-02): the F0 proof is local; agents never create secrets (AGENTS.md rule 6)                 |
| Site and agent metrics, site logs, agent logs (OTLP logs and metrics from the browser and from the agent)                                | AD-093: the site and the agent have no metric or log subject in F0; the relay carries traces only                       |
| Domain metrics of features that do not exist yet (`queue.wait_time`, `ready_check.outcome`, `match.dispute_rate`, `room.member.dropped`) | Their use cases arrive in F1; instruments are created with the use case                                                 |
| `agent.read_rate`                                                                                                                        | The agent reads a fixture in F0 (AGS-33); real reads and the metric are F2                                              |
| A span on the site for the arrival of an SSE event                                                                                       | The SSE payload would need a trace field: a contract change (AD-086); the server-side delivery span covers the hop      |
| A link between the site trace and the agent trace of the same room                                                                       | AD-092: two complete traces; a span link would need the room to store the match trace, a lobby change                   |
| SLOs and error-budget alerts, deploy and release markers, the OpenTelemetry Collector with tail sampling                                 | Design doc operations after the free tier; none is an F0 exit criterion                                                 |
| Dashboards beyond one skeleton dashboard                                                                                                 | The funnel, wait heat map and read-rate panels need F1/F2 metrics                                                       |
| Egress bytes per player-hour and Neon CU metrics                                                                                         | `load-baseline` publishes bytes per player-hour (NFR-14); Neon CU comes from the provider                               |
| Decoding or filtering relayed OTLP bodies                                                                                                | AD-084: the relay is a guarded pass-through; redaction is the sender's guarantee and the backend treats it as untrusted |
| Changing any existing route, event or message                                                                                            | Contracts first: the only contract change is the new relay route (OBS-42) and the outbox column                         |

---

## Assumptions & Open Questions

| Assumption / decision              | Chosen default                                                                                                                                                                                                                                        | Rationale                                                                                                                     | Confirmed? |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Telemetry backend for the F0 proof | Local `grafana/otel-lgtm` in Docker; production configuration is environment only, with no secret in the repository (AD-088)                                                                                                                          | Maintainer answered "yes" to local-only and to Docker (2026-11-02)                                                            | y          |
| Wire format and trust of the relay | `POST /v1/telemetry/traces`, body OTLP/HTTP (`application/x-protobuf` or `application/json`), forwarded to the backend unchanged, answered `202` at once, forwarded in the background with a 5 s timeout (AD-084)                                     | Both SDKs speak OTLP/HTTP; no decoding means no schema to maintain; the backend is a free tier that tolerates a bounded flood | n          |
| Who may call the relay             | A bearer agent token, or a signed-in site session whose `Origin` is the site origin; nobody else                                                                                                                                                      | The relay is a write path to the maintainer's quota; credentials and the origin check already exist (AWS)                     | n          |
| How the browser reaches the relay  | Through the same-origin Pages Function proxy the site already uses for every API call (AWS-29); the proxy's header allow-list gains `traceparent` and `tracestate` where it lacks them; no CORS is added                                              | Cross-origin calls would need CORS on a credentialed endpoint; the proxy removes the need                                     | n          |
| Order of the relay checks          | Authentication (`401`, or `403` for a wrong origin) → per-principal rate (`429`) → content type and encoding (`415`) → size (`413`); unauthenticated requests are limited to 120 a minute per client address (`429`)                                  | Cheapest checks first; credentials before reading a body; a stated flood limit instead of none                                | n          |
| Relay limits                       | 1 MiB of body as received (no content encoding is accepted), 60 requests a minute per principal                                                                                                                                                       | Conservative numbers for a single free instance (ADR 006)                                                                     | n          |
| The two traces of a room (AD-092)  | The site's "Start test match" is the root of trace A (site, API, Postgres, outbox relay, delivery of the `awaiting_host` room); the agent's observation is the root of trace B (agent span, API spans, Postgres, outbox relay, delivery of `created`) | `Created` is written in the agent's request, so its outbox row carries the agent's trace; a link between them is out of scope | n          |
| Staging endpoints in the e2e stack | The acceptance stack runs the API with `ENABLE_STAGING_ENDPOINTS=true`, as the existing "test room becomes Created" scenario does                                                                                                                     | "Start test match" exists only there (AWS)                                                                                    | y          |
| How the outbox keeps the trace     | A nullable column `trace_context` (W3C `traceparent` text) on `platform.outbox`, written in the transaction that writes the event; the relay opens a span that continues it (AD-085)                                                                  | The outbox is the only async hop and has no carrier                                                                           | n          |
| How the SSE hop joins the trace    | The server-side span `platform.stream.deliver` is a child of `platform.outbox.relay`; the browser does not report receipt (AD-086)                                                                                                                    | `EventSource` cannot read a trace field without a payload change (contract change)                                            | n          |
| Sampling                           | Parent-based, ratio from `OTEL_TRACES_SAMPLER_ARG`, default `0.1`; the acceptance stack sets `1.0` (AD-089)                                                                                                                                           | ADR 013: free-tier quotas limit sampling, so the conservative default is not "keep everything"                                | n          |
| Site telemetry switch              | The web build exports only when `VITE_TELEMETRY=on`; local and staging builds set it, the production build does not until the maintainer decides on a notice (NFR-04, NFR-05) (AD-090)                                                                | Sending browser telemetry of players to a third party is a privacy decision that is not made yet                              | n          |
| Attribute names                    | The `d2r.*` attributes of the design doc are constants in `packages/telemetry`; today's camelCase ids that map to one (`roomId`) are renamed, and ids that would identify an account (`accountId`, `agentId`) are dropped (AD-091)                    | The design doc fixes the names; PRD forbids BattleTag and character names; account ids stay off telemetry                     | n          |
| Name of the use-case spans         | Unchanged (`lobby.record-observation`, `matchmaking.form-test-match`, …); the design doc's `lobby.observe` and `matchmaking.match` were draft names (AD-091)                                                                                          | Already shipped and tested (AWS-35); a rename is churn                                                                        | n          |
| Metrics created in F0              | `http.server.response.body.size`, `sse.connections`, `outbox.lag`, `room.stage_duration`, and `http.server.request.duration` from the HTTP instrumentation (AD-087)                                                                                   | They have a subject in the skeleton; the dashboard's rate, error and duration panels need the request duration                | n          |
| Logs                               | The API's Fastify (pino) logs are JSON with `trace_id` and `span_id` and are exported over OTLP with the SDK; the site and the agent export none (AD-093)                                                                                             | NFR-09 says logs in three apps; only the API has a log subject today                                                          | n          |
| Docker in CI                       | The acceptance job already runs Testcontainers; the trace scenario runs there with the same Docker                                                                                                                                                    | `tests/acceptance` stack uses a Testcontainers Postgres today                                                                 | n          |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Traces from the click to the stream event ⭐ MVP

**User Story**: As the maintainer, I want a player's action to leave one trace through the site, the API, Postgres, the
outbox and the stream, and the agent's observation to leave another, so that I can see where time goes and prove the
pipeline works end to end.

**Why P1**: F0 exit criterion "One trace: site click → API → Postgres → outbox → SSE; agent spans linked by `traceparent`" (NFR-09).

**Acceptance Criteria**:

1. WHEN the API starts with `OTEL_EXPORTER_OTLP_ENDPOINT` set THEN it SHALL install an OpenTelemetry SDK in `main/` that exports traces and metrics to that endpoint over OTLP/HTTP.
2. WHEN the API starts with `OTEL_EXPORTER_OTLP_ENDPOINT` unset THEN it SHALL start without exporting and without an error.
3. The API SHALL instrument its HTTP server, Fastify routes and `pg`, so that each request produces a server span and each query a child span of it, and a `pg` span SHALL name the statement without parameter values.
4. WHEN the site calls the API THEN it SHALL send a `traceparent` header on that request, SHALL open a span for the action and for each navigation, and the navigation span SHALL record the path without the query string.
5. WHEN a use case commits an outbox event THEN the API SHALL store the W3C `traceparent` of the active span in the new nullable column `trace_context` of `platform.outbox` in the same transaction.
6. WHEN the outbox relay publishes an event with a stored `trace_context` THEN it SHALL open the span `platform.outbox.relay` as a child of that context, and SHALL open `platform.stream.deliver` as a child of `platform.outbox.relay` for each stream connection that receives the event.
7. IF an outbox row has no `trace_context` THEN the relay SHALL publish it and open a new root span, and SHALL NOT fail.
8. WHEN a signed-in player starts a test match from the site THEN one trace id SHALL contain the site action span, the API request span, at least one `pg` span, `platform.outbox.relay` and `platform.stream.deliver`.
9. The Pages Function proxy SHALL forward `traceparent` and `tracestate` to the API on every proxied request.

**Independent Test**: start the stack with the local backend, run the scenario, and read the trace by id from Tempo.

---

### P1: The agent and the site export through a relay ⭐ MVP

**User Story**: As the maintainer, I want the site and the agent to send their spans to the API, which holds the backend
credentials, so that no secret is shipped in a browser bundle or an installer and the backend can be swapped by
configuration (ADR 013).

**Why P1**: the design doc routes site and agent OTLP through a relay; the agent's spans must reach the backend for its trace to exist.

**Acceptance Criteria**:

1. WHEN an agent with a valid token, or a signed-in site session whose `Origin` is the site origin, sends `POST /v1/telemetry/traces` with an OTLP body of at most 1 MiB, content type `application/x-protobuf` or `application/json` and no content encoding THEN the API SHALL answer `202` with an empty body at once and SHALL forward the body unchanged to the configured backend with its credentials, in the background, with a timeout of 5 s.
2. IF the request has neither a valid agent token nor a valid session THEN the API SHALL answer `401` and forward nothing.
3. IF a request carries a valid session whose `Origin` is not the site origin THEN the API SHALL answer `403` and forward nothing.
4. IF a principal sends more than 60 relay requests in a minute THEN the API SHALL answer `429` with `Retry-After` and forward nothing; IF one client address sends more than 120 unauthenticated relay requests in a minute THEN the API SHALL answer `429` as well.
5. IF the content type is not one of the two accepted, or a content encoding is present, THEN the API SHALL answer `415` and forward nothing.
6. IF the body is larger than 1 MiB, declared or received, THEN the API SHALL answer `413` and forward nothing.
7. The relay SHALL apply its checks in this order: authentication, rate, content type and encoding, size.
8. IF the backend is unreachable, answers an error or exceeds the timeout THEN the relay SHALL have answered `202`, SHALL log one warning without the body, and SHALL NOT retry.
9. The relay SHALL NOT return a header or a body from the backend, and the backend credentials SHALL NOT appear in a response, a log or a span.
10. The agent SHALL export its spans as OTLP/HTTP to the relay on the API base it already uses, from a queue of at most 2048 spans that drops the oldest span when full.
11. The agent's exporter SHALL NOT block a loop, a request or the UI; IF the relay answers `401`, `403`, `413` or `415` THEN it SHALL drop that batch, and IF it answers `429` THEN it SHALL wait for `Retry-After` before the next batch.
12. WHEN the agent sends a heartbeat, an observation or opens the stream THEN the API's server span for that request SHALL be a child of the agent's `agent.http.*` span, with the same trace id.
13. The site SHALL export its spans through the same relay, with the same limits.
14. The agent's domain crate SHALL NOT depend on any tracing or OpenTelemetry crate, and the exporter SHALL live in the adapters crate.

**Independent Test**: post an OTLP fixture with and without a token; run the agent's gateway against the fake API and see the exported body arrive at the relay.

---

### P1: A local backend and an end-to-end proof ⭐ MVP

**User Story**: As a maintainer, I want a backend I can start with one command and a test that reads the traces back so
that "the trace exists" is checked by code, not by eye.

**Why P1**: the design doc says the end-to-end tests verify that a complete trace was produced.

**Acceptance Criteria**:

1. The repository SHALL contain `infra/observability/compose.yaml` that starts `grafana/otel-lgtm` pinned to an image tag, and `pnpm obs:up` and `pnpm obs:down` SHALL start and stop it.
2. WHEN the trace scenario runs THEN it SHALL start the API with its OTLP endpoint pointing at that backend, sampling ratio `1.0` and staging endpoints enabled, drive the site in a browser, run the agent as a headless process of the real agent core with the real HTTP gateway, the telemetry exporter and the `fixture-read` feature (AGS-33), so that the agent itself emits the `agent.http.*` spans, and poll Tempo for the traces for at most 30 s.
3. WHEN the traces are found THEN the scenario SHALL assert the span names and the parent-child edges of OBS-08 and OBS-12 and SHALL print both trace ids.
4. IF Docker is unavailable THEN the scenario SHALL fail with a message that names Docker as the missing prerequisite, and SHALL NOT pass without having read a trace; the scenario carries the tag `@slow`.

**Independent Test**: `pnpm test:acceptance -- --grep @OBS-08`.

---

### P1: Telemetry that cannot leak ⭐ MVP

**User Story**: As a player and a maintainer, I want telemetry free of secrets and personal data so that exporting it
to a third-party backend is safe (ADR 013, NFR-04).

**Why P1**: PRD and ADR 013: attributes free of secrets and PII; the relay and the URLs widen the surface.

**Acceptance Criteria**:

1. API logs SHALL be JSON lines carrying `trace_id` and `span_id` of the active span when there is one.
2. WHEN `OTEL_EXPORTER_OTLP_ENDPOINT` is set THEN the API SHALL export its logs over OTLP with the same trace correlation.
3. The telemetry package SHALL strip from every span, metric and log record, before export, any attribute whose full key, or whose last dot-separated segment, equals `authorization`, `cookie`, `set-cookie`, `token`, `code`, `secret`, `password`, `image` or `battletag` (case-insensitive); the keys `pairing.code`, `http.request.header.authorization` and `x-token` SHALL be stripped, and `http.response.status_code`, `db.statement` and `d2r.room.id` SHALL be kept.
4. The telemetry package SHALL remove the query string and the fragment from every attribute value that holds a URL (`url.full`, `http.url`, `http.target`, `url.query`) and SHALL drop `client.address`, `user_agent.original` and every `enduser.*` attribute.
5. The standardized attributes (`d2r.room.id`, `d2r.queue.mode`, `d2r.difficulty`, `d2r.ladder`, `d2r.era`, `d2r.agent.version`) SHALL be exported as constants from `packages/telemetry`; no span SHALL carry a BattleTag, a character name or an account id.
6. Metric attributes SHALL be limited to bounded sets (route template, status class, room stage, difficulty, mode), never an id.
7. Every exported resource SHALL carry `service.name` (`d2rmm-web`, `d2rmm-api` or `d2rmm-agent`), `service.version` and `deployment.environment`; the agent's SHALL also carry `d2r.agent.version`.

**Independent Test**: unit tests over the redaction processor with a fixture span holding each forbidden key and URL; a scan of every span, metric and log exported during the trace scenario.

---

### P1: Metrics and one dashboard as code ⭐ MVP

**User Story**: As the maintainer, I want the skeleton's few metrics and a dashboard in the repository so that the
telemetry has a reader from day 0.

**Why P1**: NFR-09 asks for metrics from day 0; the design doc keeps dashboards as code in `infra/observability/`.

**Acceptance Criteria**:

1. The API SHALL record `http.server.response.body.size` (histogram, by route template and status class), `http.server.request.duration` (histogram, by route template and status class), `sse.connections` (up-down counter, by stream kind) and `outbox.lag` (gauge in seconds, the age of the oldest unpublished row, 0 when none).
2. WHEN a room reaches `created` THEN the API SHALL record `room.stage_duration` (histogram in seconds, by stage) once, for the stage it left immediately before (`awaiting_host`), as the seconds since that stage began.
3. `infra/observability/dashboards/skeleton.json` SHALL hold a Grafana dashboard with request rate, error rate and duration per route, `outbox.lag` and `sse.connections`, and the compose file SHALL provision it.
4. A test SHALL fail if a panel of the dashboard queries a metric that the code does not define.

**Independent Test**: a unit test lists the instruments and the dashboard's queries and compares them.

---

### P2: Telemetry never hurts the product

**User Story**: As a player, I want the product to work the same when the telemetry backend is down or not configured.

**Why P2**: observability must not become a dependency; it is a robustness rule rather than an exit criterion.

**Acceptance Criteria**:

1. IF the telemetry endpoint is unreachable THEN the API SHALL answer every request exactly as when it is reachable, and the API logs SHALL show at most one export error per minute.
2. IF the agent's relay is unreachable THEN the agent SHALL keep pairing, beating, reading and posting, and its logs SHALL show at most one export error per minute.
3. The exporter settings SHALL be read only in `main/` (API) and in the composition root (agent), and `packages/telemetry` SHALL take them as arguments and SHALL NOT read `process.env`.
4. The repository SHALL contain `.env.example` with every `OTEL_*` variable the API reads and placeholder values only.
5. Use-case spans SHALL stay in the application layer and the domain SHALL emit none.
6. The relay route SHALL be in `openapi.json`, regenerated by `pnpm contracts:openapi`.
7. The API SHALL use a parent-based sampler whose ratio is `OTEL_TRACES_SAMPLER_ARG`, `0.1` when unset.
8. The web build SHALL export spans only when `VITE_TELEMETRY` is `on`.

**Independent Test**: start the API pointing at a closed port and run the API integration suite; `pnpm lint` fails on a `process.env` fixture in the telemetry package.

---

## Edge Cases

- WHEN the site is open in two tabs THEN each tab SHALL start its own trace per action; nothing joins them (follows from OBS-04).
- WHEN an agent token is revoked while the exporter holds queued spans THEN the next relay request SHALL be answered `401` and the exporter SHALL drop that batch (OBS-11, OBS-19).
- WHEN a trace is partly sampled out THEN the child spans SHALL follow the parent's decision (parent-based sampler, OBS-43).
- WHEN the agent's observation moves the room to `created` THEN the `created` event SHALL appear in the agent's trace, not in the site's (AD-092, OBS-12).

---

## Requirement Traceability

| Requirement ID | Story                                                     | Phase  | Status  |
| -------------- | --------------------------------------------------------- | ------ | ------- |
| OBS-01         | P1: Traces from the click to the stream event (AC 1)      | Design | Pending |
| OBS-02         | P1: Traces from the click to the stream event (AC 2)      | Design | Pending |
| OBS-03         | P1: Traces from the click to the stream event (AC 3)      | Design | Pending |
| OBS-04         | P1: Traces from the click to the stream event (AC 4)      | Design | Pending |
| OBS-05         | P1: Traces from the click to the stream event (AC 5)      | Design | Pending |
| OBS-06         | P1: Traces from the click to the stream event (AC 6)      | Design | Pending |
| OBS-07         | P1: Traces from the click to the stream event (AC 7)      | Design | Pending |
| OBS-08         | P1: Traces from the click to the stream event (AC 8)      | Design | Pending |
| OBS-09         | P1: Traces from the click to the stream event (AC 9)      | Design | Pending |
| OBS-10         | P1: The agent and the site export through a relay (AC 1)  | Design | Pending |
| OBS-11         | P1: The agent and the site export through a relay (AC 2)  | Design | Pending |
| OBS-12         | P1: The agent and the site export through a relay (AC 12) | Design | Pending |
| OBS-13         | P1: The agent and the site export through a relay (AC 6)  | Design | Pending |
| OBS-14         | P1: The agent and the site export through a relay (AC 4)  | Design | Pending |
| OBS-15         | P1: The agent and the site export through a relay (AC 8)  | Design | Pending |
| OBS-16         | P1: The agent and the site export through a relay (AC 9)  | Design | Pending |
| OBS-17         | P1: The agent and the site export through a relay (AC 3)  | Design | Pending |
| OBS-18         | P1: The agent and the site export through a relay (AC 10) | Design | Pending |
| OBS-19         | P1: The agent and the site export through a relay (AC 11) | Design | Pending |
| OBS-20         | P1: The agent and the site export through a relay (AC 5)  | Design | Pending |
| OBS-21         | P1: The agent and the site export through a relay (AC 13) | Design | Pending |
| OBS-22         | P1: The agent and the site export through a relay (AC 14) | Design | Pending |
| OBS-23         | P1: A local backend and an end-to-end proof (AC 1)        | Design | Pending |
| OBS-24         | P1: A local backend and an end-to-end proof (AC 2-3)      | Design | Pending |
| OBS-25         | P1: A local backend and an end-to-end proof (AC 4)        | Design | Pending |
| OBS-26         | P1: Telemetry that cannot leak (AC 1)                     | Design | Pending |
| OBS-27         | P1: Telemetry that cannot leak (AC 2)                     | Design | Pending |
| OBS-28         | P1: Telemetry that cannot leak (AC 3)                     | Design | Pending |
| OBS-29         | P1: Telemetry that cannot leak (AC 4)                     | Design | Pending |
| OBS-30         | P1: Telemetry that cannot leak (AC 5)                     | Design | Pending |
| OBS-31         | P1: Telemetry that cannot leak (AC 6)                     | Design | Pending |
| OBS-32         | P1: Telemetry that cannot leak (AC 7)                     | Design | Pending |
| OBS-33         | P1: Metrics and one dashboard as code (AC 1)              | Design | Pending |
| OBS-34         | P1: Metrics and one dashboard as code (AC 2)              | Design | Pending |
| OBS-35         | P1: Metrics and one dashboard as code (AC 3)              | Design | Pending |
| OBS-36         | P1: Metrics and one dashboard as code (AC 4)              | Design | Pending |
| OBS-37         | P2: Telemetry never hurts the product (AC 1)              | Design | Pending |
| OBS-38         | P2: Telemetry never hurts the product (AC 2)              | Design | Pending |
| OBS-39         | P2: Telemetry never hurts the product (AC 3)              | Design | Pending |
| OBS-40         | P2: Telemetry never hurts the product (AC 4)              | Design | Pending |
| OBS-41         | P2: Telemetry never hurts the product (AC 5)              | Design | Pending |
| OBS-42         | P2: Telemetry never hurts the product (AC 6)              | Design | Pending |
| OBS-43         | P2: Telemetry never hurts the product (AC 7)              | Design | Pending |
| OBS-44         | P2: Telemetry never hurts the product (AC 8)              | Design | Pending |

OBS-20 stands for the relay's content-type and encoding rule (AC 5) and its check order (AC 7) together.

---

## Sources

- `docs/product/prd.md#NFR-09` - traces, metrics and logs in OpenTelemetry from day 0, in the three apps → OBS-01…OBS-09, OBS-24, OBS-26, OBS-27, OBS-33…OBS-36, OBS-43
- `docs/product/prd.md#NFR-04` - nothing sensitive stored or exported beyond need → OBS-28…OBS-31, OBS-44
- ADR 013 (OpenTelemetry to a swappable backend) - OTLP, backend configured only in `main/`, `traceparent` link, no secrets or PII in attributes → OBS-01, OBS-10…OBS-21, OBS-28…OBS-32, OBS-39, OBS-40
- ADR 010 (read-only agent) - the agent sends data only; the relay answers an empty `202`, never a command → OBS-10, OBS-16, OBS-18, OBS-19
- ADR 006 (single instance, no queue service) - the relay forwards in the process with bounded limits → OBS-10, OBS-14, OBS-15
- ADR 003 and ADR 027 (hexagonal layers) - spans in the application, exporter in the adapters, none in the domain → OBS-22, OBS-41
- `docs/architecture/design-doc.md` § Observabilidade com OpenTelemetry - relay, instrumentation, standard attributes, metrics table, dashboards as code, `grafana/otel-lgtm` → all
- `docs/engineering/telemetry.md` - span naming `<context>.<use-case>`, bounded cardinality, no ids on metrics, JSON logs with trace id → OBS-26, OBS-31, OBS-33
- `.specs/features/api-web-skeleton/spec.md` (AWS-29, AWS-31, AWS-35) - the same-origin proxy, the `process.env` rule and the use-case spans this feature builds on → OBS-09, OBS-17, OBS-39, OBS-41
- `.specs/features/agent-skeleton/spec.md` (AGS-12, AGS-33) - the agent's spans, `traceparent`, and the `fixture-read` feature for the end-to-end run → OBS-12, OBS-18, OBS-24
- `.specs/features/agent-hexagonal-migration/spec.md` (AHM-18) - where the agent's telemetry lives → OBS-22
- `.specs/phases/F0/brief.md` - exit criteria "One trace…" and "Pairing by code and heartbeat end to end - proof: e2e test + trace" → OBS-08, OBS-12, OBS-24
- AD-084…AD-093 (assumed, AD-088 confirmed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] `pnpm test:acceptance -- --grep @OBS-08` finds trace A in Tempo with the site action, the API request, a `pg` span, `platform.outbox.relay` and `platform.stream.deliver`, and trace B with the agent's span as the parent of the API spans of its heartbeat and observation.
- [ ] Posting to the relay without credentials, from another origin, with a wrong content type, over 1 MiB, or past 60 requests a minute is refused with `401`, `403`, `415`, `413` and `429`, and nothing reaches the backend.
- [ ] No exported span, metric or log record in the trace scenario holds a forbidden key, a query string or a player name.
- [ ] `pnpm check` and `pnpm contracts:openapi` leave no drift; `pnpm obs:up` starts the local backend with the skeleton dashboard.
