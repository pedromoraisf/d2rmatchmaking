# Telemetry

OpenTelemetry in all three apps from day 0 (ADR 013). Export is OTLP; the backend (Grafana Cloud in the MVP) is
configured only in `apps/api/src/main/` and the apps' bootstrap via env.

- **Traces**: one trace from the site click → API → Postgres → outbox → SSE event; the agent's spans link via
  `traceparent` on heartbeat/observation requests. Span names: `<context>.<use-case>` (e.g. `lobby.record-observation`).
- **Metrics**: queue wait by difficulty, ready-check acceptance, rooms reaching `active`, agent read rate,
  SSE connections, **egress bytes per player-hour**, Neon CU usage, outbox lag.
- **Logs**: structured JSON with trace id; never tokens, cookies, raw images or full chat lines.
- Attributes: bounded cardinality (difficulty, mode, region, stage). No account ids on metrics.

## Names read on screen (SNM-04, ADR 036)

A character name or a chat name read on screen is personal data of whoever typed it. It exists in the memory of one request
and is never in a span, span event, log line, metric label, outbox row, event, error body or response, nor a part, a hash
or the length of it.

| Where                                 | What it may carry                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API span `lobby.record-observation`   | `d2r.observation.type` and `d2r.observation.match` (`matched`, `none`, `ambiguous`) for a sighting |
| API span `identity.record-characters` | `d2r.characters.count`, and `d2r.characters.reconciled` (a count, only above zero)                 |
| Agent chat post (batch 2)             | fixed words `joined` and `left`, and `posted`, `dropped`, `failed`                                 |

`apps/api/src/main/__tests__/name-leak-scan.ts` is the harness that scans spans, logs, answers and stored rows for a name;
every path that takes a read name has a test with it, and each runs in both telemetry tiers.

**The staging exception (ADR 037, OBT-04, OBT-09).** In the **full** tier (staging, local) a name may be on a span, and
only there, under the keys the tier carries (`d2r.account.battletag`, `d2r.character.name`, `d2r.observation.read_text`,
`d2r.observation.read_names`, and the agent's `d2r.ocr.*`). Use cases set them through the `SpanDetail` port, which the
composition root (`main/span-detail.ts`) gives the full tier and withholds from production; the exporter drops the same
keys in production again. A name is still never in a log line, metric label, outbox row, event, stored row or response,
in either tier. The **production** tier keeps the rule above whole.

## Production backend

The API (`d2rmm-api` on Render) exports its traces, metrics and logs over OTLP/HTTP to **Grafana Cloud** (ADR 013). The
site and the desktop agent keep production telemetry **off** (AD-098); only the API exports. The provider appears only in
`apps/api/src/main/` (`config.ts` reads the environment), never in a module or in `packages/telemetry`.

- **Stack**: one Grafana Cloud stack, region `sa-east-1`.
- **Wire format**: protobuf, gzip-compressed (`@opentelemetry/exporter-*-otlp-proto` 0.223.0 with `CompressionAlgorithm.GZIP`
  in `packages/telemetry/src/node-sdk.ts`). The browser exporter and the relay (which forwards the site's bodies unchanged)
  are not affected.
- **Render variables** (set in the dashboard, never in the repository):

  | Variable                      | Value                                                                               |
  | ----------------------------- | ----------------------------------------------------------------------------------- |
  | `OTEL_EXPORTER_OTLP_ENDPOINT` | the stack's OTLP endpoint, from its OpenTelemetry connection page (ends in `/otlp`) |
  | `OTEL_EXPORTER_OTLP_HEADERS`  | `Authorization=Basic <base64(instanceId:token)>`                                    |

  The header value is the OpenTelemetry environment format: `key=value` pairs separated by commas, values percent-decoded.
  The space after `Basic` can be written as `%20` or as a literal space; `config.ts` decodes both. The token is an access
  policy token that may write traces, metrics and logs (the stack's OpenTelemetry connection page creates it). It is never
  logged.

- **Verify**: in Grafana, Explore → the Tempo data source → `{resource.service.name="d2rmm-api"}` shows the traces; the
  Prometheus data source shows `d2r_queue_size` and the other instruments; Loki shows the logs of `service_name="d2rmm-api"`.
- **Why it is on before AD-128 is met**: AD-128 conditions the production endpoint on the telemetry share of the 5 GiB monthly
  egress budget being at most 0.10. The maintainer decided on **2026-11-20** to enable it ahead of that condition because
  real traffic is low today; the load baseline is the reason to keep measuring. The last baseline
  ([`load-baseline.md`](load-baseline.md), 2026-11-04, uncompressed OTLP JSON) measured about 755 KB of telemetry per
  player-hour, a share of 10.12 at 100 players, roughly 100 times the limit and above Grafana Cloud free's 50 GB a month
  at 100 players. It is a decision to revisit as traffic grows, not a finding that the limit is met.
- **Per-signal numbers**: the load harness now counts the sink's wire bytes per signal (`/v1/traces`, `/v1/metrics`,
  `/v1/logs`) and writes `telemetryBytesPerPlayerHourBySignal` to the summary and the published baseline. The first
  measurement with gzip protobuf has not been taken yet: it runs in the nightly (ADR 035), and the numbers go here and into
  `load-baseline.md` when it does. Until then, the 755 KB figure above is the JSON, uncompressed one.
- **Dashboards**: `infra/observability/dashboards/*.json` are portable (a `datasource` variable, queries filtered on
  `job="d2rmm-api"`, which the OTLP to Prometheus mapping sets from `service.name`). The `publish-dashboards` workflow
  (`.github/workflows/publish-dashboards.yml`) upserts them into the Grafana Cloud folder **D2RMM** with
  `scripts/obs/publish-dashboards.mjs` on a push to `main` that touches them, and on demand. It needs two repository
  secrets, created by the maintainer: `GRAFANA_URL` (the stack URL, `https://<stack>.grafana.net`) and `GRAFANA_SA_TOKEN`
  (a Grafana service account token whose role can write dashboards and folders). Without them
  the job prints a notice and succeeds.
- **Render previews** (ADR 030) inherit the API service's environment, so a preview API exports to the same stack with the
  same two variables. Its `service.version` and `deployment.environment` tell it apart from the main service.
- **The production service**: the future production Render service (delivery-platform, batch 3) needs the same two
  variables set on it. `render.yaml` does not carry them (they are secrets) and is not changed for this.

## Reading the traces

Every span name below was read from the code (`git grep` on `withSpan`, `withRecordingSpan` and `startActiveSpan`).

### Why some API traces show "root span not received"

- **Agent requests.** Every request of the desktop agent carries the `traceparent` of the agent's own `agent.http.<op>`
  span (AGS-12; `apps/agent/src-tauri/adapters/src/http/api_client.rs`). The API's HTTP server span follows that remote
  parent. Production agent telemetry is off (AD-098), so the parent span is never exported and Grafana shows the trace
  without its root. The API spans of that trace are complete; only the agent's side is missing. The `<op>` values are
  `request_code`, `claim`, `heartbeat`, `assignment`, `observation`, `ready_check`, `my_ready_check`, `characters` and
  `stream`.
- **Site requests** are true roots: production site telemetry is off too, so the browser sends no `traceparent` that
  leads to an exported span.
- **To list only the traces whose root arrived**, use a TraceQL query on the structural root, in Explore → Tempo:
  `{ resource.service.name = "d2rmm-api" && nestedSetParent = -1 }`. A trace whose first API span has a remote parent that
  was never received has no span with `nestedSetParent = -1` from the agent, so it does not match. This query was written
  from the TraceQL documentation and has **not** been run against the local stack or Grafana Cloud; check it on a real agent
  trace before relying on it.

### Anatomy of a trace

```text
HTTP server span (instrumentation-http: named by method only, with url.path and http.route attributes)
└─ <context>.<use-case>          application span (withSpan / withRecordingSpan), attributes are ids and bounded enums
   ├─ pg.query:<COMMAND> <db>    one child per SQL statement (instrumentation-pg, no statement text)
   └─ <other-context>.<use-case> a port call into another module is a child application span of the caller
```

`/healthz` and `/v1/telemetry/traces` (the relay) are not traced as server spans. The spans carry no tokens, codes, names or
IP addresses (`SpanAttributes`: ids and bounded enums only).

### Span names by journey step

| Step                          | Span                                                                                                                                                                                                           | Meaning                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity: sign-in**         | `identity.sign-in-battle-net`, `identity.sign-in-test-account`, `identity.sign-out-session`, `identity.authenticate-session`                                                                                   | The Battle.net sign-in (and the test-account sign-in used by tests), the sign-out, and the session check that most requests run first.                                                                                                                                                                           |
| Identity: account and toons   | `identity.get-me`, `identity.declare-character`, `identity.list-characters`, `identity.record-characters`, `identity.character-of`, `identity.is-linked`                                                       | Reading the account, declaring a character, listing and recording what the agent read, and the lookups other modules call through a port.                                                                                                                                                                        |
| **Agents: pairing**           | `agents.request-pairing-code`, `agents.pair-agent`, `agents.claim-token`, `agents.revoke`                                                                                                                      | The site asks for a pairing code, the agent pairs with it, the site claims the agent token, a player revokes an agent.                                                                                                                                                                                           |
| Agents: presence              | `agents.authenticate-agent`, `agents.record-heartbeat`, `agents.sweep`, `agents.get-my-agent`, `agents.agent-online-of`, `agents.agent-offline-since-of`, `agents.account-of-agent`, `agents.current-agent-of` | Every agent request authenticates first; a heartbeat marks the agent online; the sweep marks silent agents offline; the rest are the player's view and the lookups other modules call.                                                                                                                           |
| **Matchmaking: queue**        | `matchmaking.join`, `matchmaking.leave`, `matchmaking.match`, `matchmaking.form-test-match`                                                                                                                    | A player joins or leaves the queue; `matchmaking.match` is one run of the matcher (an idle tick with nobody queued records no span); `form-test-match` is the test control that forms a match on demand.                                                                                                         |
| Matchmaking: ready check      | `matchmaking.ready-check.open`, `matchmaking.ready-check.answer`, `matchmaking.ready-check.resolve`                                                                                                            | A match opens its ready check, a player answers it, and it resolves as accepted, declined or timed out.                                                                                                                                                                                                          |
| **Lobby Room: assignment**    | `lobby.on-match-formed`, `lobby.on-assignment-delivered`, `lobby.get-assignment`, `lobby.get-current-room`, `lobby.has-open-room`                                                                              | A formed match opens one room (idempotent by match id), the assignment reaches the agents, and the reads of the room and of the assignment.                                                                                                                                                                      |
| Lobby Room: observation       | `lobby.record-observation`                                                                                                                                                                                     | The agent's reading of the game window. The span **links** to the span that opened the room (the stored `traceparent` of `lobby.on-match-formed`, RTL-03), so the observation trace and the match trace are connected through the link, not through a parent. A repeated or `UNKNOWN` observation is linked too. |
| Lobby Room: stage and members | `lobby.open-next-run`, `lobby.leave-room`, `lobby.close-room`, `lobby.expire-rooms`, `lobby.drop-absent-members`                                                                                               | The host's and members' actions on a room, and the two sweeps that expire rooms and drop members who stopped being seen.                                                                                                                                                                                         |
| **Platform: outbox relay**    | `platform.outbox.relay`                                                                                                                                                                                        | One per outbox row published. It is started in the context stored with the row (`trace_context`), so it is a child of the span that wrote the event; a row with no valid stored context starts a new trace.                                                                                                      |
| Platform: streams             | `platform.stream.deliver`                                                                                                                                                                                      | The hand-off of one event to one open event stream, a child of the relay span that published it; the `d2r.stream.kind` attribute is the kind of stream (site or agent).                                                                                                                                          |

`lobby.match-refused` is a **span event**, not a span: `lobby.on-match-formed` adds it when it refuses a match (for example
an unsupported difficulty), so look for it in the events of that span.

### Follow-up for the maintainer (not implemented)

- **`LatencyP99ErrorBuildup` fires on `d2rmm-api` in Grafana.** The likely cause is that the long-lived event-stream
  routes (SSE) are counted in `http.server.request.duration`, so a stream that stays open for minutes looks like a slow
  request. **This is unverified.** To check: group the p99 by `http_route`; if the stream routes dominate, exclude them from
  that histogram (a view or a route filter) or alert on the other routes. Listed here as a quality item.
