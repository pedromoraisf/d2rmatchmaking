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

## What each tier carries (ADR 037)

Two tiers, one value per app: **full** (staging, previews, local) and **production**. The tier comes from the environment
the app runs in (API: `D2RMM_ENV`; site: the boot configuration's `telemetryTier`; agent: the compile-time channel, where
`preview` and `staging` are full and `production`, none and any unknown value are production). An unknown input is always
production, and so is a missing one: an API started without `D2RMM_ENV` (unset or empty) is in the production tier, so a
forgotten variable never exports names (OBT-18); `D2RMM_ENV` itself still defaults to `local` for test controls, cookies
and CORS, only the tier fails closed. A developer who wants full detail runs `local.ts` with `D2RMM_ENV=local`. Every span says which tier it was made in: the resource attribute `d2r.telemetry.tier` is `full` or
`production`, so `{ resource.d2r.telemetry.tier = "full" }` selects staging in TraceQL.

In every tier, credentials never leave (tokens, cookies, pairing codes, authorization headers, IP addresses, user agents,
pixels, crops), and the agent's exporter drops every event, link, status text, URL, path and window title.

**API** (spans; metrics keep bounded labels and never gain an id):

| Data                                                                                                                            | Production |   Full    |
| ------------------------------------------------------------------------------------------------------------------------------- | :--------: | :-------: |
| `d2r.account.id`, `d2r.agent.id`, `d2r.room.id`, `d2r.run.id` (`<room id>/<run number>`), `d2r.ticket.id`, `d2r.ready_check.id` |    yes     |    yes    |
| `d2r.game.name` (the generated name), `d2r.difficulty`, `d2r.queue.mode`, `d2r.room.stage`                                      |    yes     |    yes    |
| `d2r.account.battletag`, `d2r.character.name`                                                                                   |     no     |    yes    |
| `d2r.observation.read_text`, `d2r.observation.read_names` (on `lobby.record-observation` and `identity.record-characters`)      |     no     |    yes    |
| Sampling                                                                                                                        | the ratio  | the ratio |

**Desktop agent** (spans through the relay; `d2r.telemetry.tier` and `deployment.environment` = the channel on the resource):

| Data                                                                                                                     | Production |  Full   |
| ------------------------------------------------------------------------------------------------------------------------ | :--------: | :-----: |
| `d2r.room.id`, `d2r.run.id`, `d2r.game.name`, `d2r.ocr.confidence` of a posted observation (`agent.observation.post`)    |    yes     |   yes   |
| Recognised screen (`vision.screen`), capture method and outcome (`capture.*`), search words (`vision.search`)            |    yes     |   yes   |
| Whether the other-game post went through (`post.outcome` of `agent.other_game.post`: `posted` or `failed`, nothing else) |    yes     |   yes   |
| `d2r.step.duration_ms` of the observation post and of the character-screen read                                          |    yes     |   yes   |
| `d2r.ocr.corrections` (correction classes such as `rn>m`, never a name), `d2r.agent.id`                                  |  allowed   | allowed |
| `d2r.ocr.names` (the character names read on the selection screen)                                                       |     no     |   yes   |
| `d2r.ocr.text`, `d2r.character.name`, `d2r.account.battletag`                                                            |     no     | allowed |
| Sampling                                                                                                                 |    10%     |  100%   |

"Allowed" means the sanitizer lets the key through (the value must have the fixed shape of its key: a correction list,
a confidence from 0 to 1, a generated game name, a timing up to an hour) and the agent does not record it yet:
`d2r.ocr.corrections`, the OCR text and the Party and chat names are held by the reading modules (`reading-modules.json`),
which this feature leaves untouched (rule 14, the real-print proof), and the agent does not know its own id (the pairing
answer gives it a token only), so the API's spans of the same agent carry `d2r.agent.id`. Recording them is a follow-up
that needs the `ocr-real` and `ocr-variations` counts.

**Site** (spans through the relay):

| Data                                                                                                        | Production | Full |
| ----------------------------------------------------------------------------------------------------------- | :--------: | :--: |
| `d2r.account.id`, `d2r.room.id`, `d2r.ticket.id`, `d2r.ready_check.id`, the action (`site.<area>.<action>`) |    yes     | yes  |
| The signed-in BattleTag (`d2r.account.battletag`)                                                           |     no     | yes  |
| A notice on every page that everything done there is recorded for debugging (en, pt-BR)                     |     no     | yes  |

**How the tier is enforced.** The tier modules apply it before export: `packages/telemetry/src/redact-attributes.ts`
(`redactForTier`, used by the API and the site), the agent's `adapters/src/telemetry/sanitize.rs` (`FULL_TIER_KEYS`, by
tier) and `core/src/detail.rs` (the one agent module that names a full-tier key; a production process does not build it).
`scripts/test/telemetry-tier-source.test.mjs` fails when another agent or site source names a staging-only key, so a new
field cannot skip the tier (OBT-10). `scripts/test/telemetry-flags.test.mjs` keeps the old agent switch
(`D2RMM_TELEMETRY`) out of the workflows and the agent sources.

### Following a journey in Grafana

All ids are span attributes (never metric labels). In Explore → the Tempo data source (`grafanacloud-traces`):

```text
{ span.d2r.room.id = "<room id>" }                      every span of one room: site, API, agent
{ span.d2r.account.id = "<account id>" }                everything one player did
{ span.d2r.ticket.id = "<ticket id>" }                  one queue ticket, from the join to the match
{ span.d2r.run.id = "<room id>/<run number>" }          one run of a room
{ span.d2r.room.id = "<room id>" && resource.d2r.telemetry.tier = "full" }    the same, staging only
```

A field test is read in this order: the ticket (`d2r.ticket.id`) to the match, the room (`d2r.room.id`) to the ready check
and the agent's reads, the run (`d2r.run.id`) to the observation that confirmed it. On staging the span of
`lobby.record-observation` also shows what the agent read (`d2r.observation.read_text`).

TraceQL result, run once on `grafanacloud-traces` after the staging deploy: _to be filled by the orchestrator (query, trace
count, date)_.

### Egress must be re-measured

The agent and the site export in production now, and staging samples the agent at 100%, so the numbers of the production
backend section below (755 KB per player-hour measured before this, with the API alone) are out of date. The nightly load
run (ADR 035) writes `telemetryBytesPerPlayerHourBySignal`; the first measurement with the agent and the site exporting
must be taken and put here and in `load-baseline.md`, and the 5 GiB egress budget (AD-128) checked against it. Until then
the production sampling ratio of the agent and the site stays at the default 10%.

**First re-measure (2026-11-22, API alone, full tier): AD-128's 0.10 share is not met.**

- **Source.** Nightly run 45037822441 (`workflow_dispatch` on `phase/F2`, commit `431fa30`, profile `full`, 400 players,
  300 rooms, passed), `load-report` artifact 14762014360, `summary.json`; the reference is the 100-player step. The
  figures were relayed by the F2 orchestrator from that file; the session that wrote this note could not download the
  artifact (its host is blocked by the cloud session's network policy), so it did not re-read the file. They are
  internally consistent (the three signals add up to the total; the monthly bytes and the share follow the formula) and the
  stream egress of the same file, 413 917 bytes per player-hour, matches the job log.
- **Numbers (bytes per player-hour at 100 players).**

  | Signal    | Bytes per player-hour |
  | --------- | --------------------: |
  | traces    |                62 877 |
  | metrics   |                 1 380 |
  | logs      |                16 743 |
  | **total** |            **81 000** |

  Per month at 100 players (× 720 h): 5 831 970 448 bytes (5.43 GiB), a **share of 1.086** of the 5 GiB egress budget
  against the 0.10 limit, so `withinTelemetryBudget` is false. Traces are 78% of the bytes, logs 21%, metrics 2%. The
  relay allowance (480 MiB a month, 503 316 480 bytes) is reported beside it and is not added.

- **Against the old figure.** 754 888 bytes per player-hour (2026-11-04, JSON, API alone) became 81 000, about nine times
  less, with protobuf and gzip; the share went from 10.12 to 1.086. The limit needs 536 870 912 bytes a month, that is
  7 457 bytes per player-hour: the API alone is still about 10.9 times over it.
- **Grafana Cloud free (50 GB a month).** 5.83 GB is 0.117 of it for the API alone at 100 players, so the free tier holds
  with the API alone; the agent and site spans are not in that figure.
- **Which tier the figures describe.** The load API runs with `D2RMM_ENV=staging`, so it is the **full tier**; the
  harness does not set `OTEL_TRACES_SAMPLER_ARG`, so the API sampler is the default 0.1. Production-tier figures were not
  measured; the production tier carries fewer attributes, so they are expected to be lower, but that is an estimate.
- **What is not in the figure.** The k6 journey drives HTTP and SSE only: it runs no site exporter and no agent exporter
  and posts nothing to the relay (`/v1/telemetry/traces`). `site` and `agent` in the egress lines of the run log are SSE
  subscriber classes (stream bytes), not telemetry. So the number is a **lower bound**: the agent and site spans
  (the agent at 100% on staging, 10% in production) are not measured. Task T12 of `observability-tiers` bounds them from
  span counts per room; until then the true share is at least 1.086.
- **Formula.** `telemetryMonthlyBytes = telemetryBytesPerPlayerHour × 100 players × 720 h`; the share is that over
  5 GiB (5 368 709 120 bytes). The wire format is protobuf with gzip (see below).
- **Decision for the maintainer, not taken here.** The share is over the limit by about 10.9 times with the API alone. The
  sampling ratios were not changed by this note; reducing traces (78%) and logs (21%) is a separate decision, and the
  production endpoint stays on the 2026-11-20 decision below.

### Where the telemetry bytes go (local profile, 2026-11-22, aa455127)

The nightly's 81 000 bytes per player-hour (share 1.086) say how much, not what. This is the first split by span name,
log record and metric.

- **Method.** `LOAD_PROFILE=full LOAD_MAX_STEPS=1 LOAD_TELEMETRY_CAPTURE_DIR=<dir> node scripts/load/run.mjs` runs the
  first step of the full ladder (25 players, 20 s ramp, 120 s hold; 19 rooms, 358 requests, 0 errors) with the sink
  writing each OTLP body to `<dir>` (the bodies hold attribute values, so the harness refuses, before the run starts, a `<dir>` that resolves inside the repository, symlinks and `..` included: use a directory under `$TMPDIR`); then `node scripts/load/telemetry-breakdown.mjs <dir>` decodes the protobuf (after
  gzip) and ranks by span name, by log scope, severity and event name (or the body when it is a fixed phrase), and by
  metric name. Output holds names and attribute keys only, never a value. Both variables are off by default and the
  profile, ratchets, ceilings and sampling are unchanged (API sampler 0.1, the harness sets none). The capture covers the
  whole run (160 s from the first to the last export), not only the 90 s measuring window: 26 trace requests (1 198 spans),
  45 log requests (131 records), 2 metric requests (28 metrics).
- **Two measures.** _Raw protobuf share_ is the item's bytes over the signal's bytes before gzip. _Wire share_ is the gzip
  bytes the name adds: the requests gzipped with it, minus the same requests without its spans or records (the marginals
  overlap a little, so they do not add up exactly). Rank on the wire share: the API writes one `ResourceSpans` per span
  (a 131-byte resource and a 45-byte scope each time, 39% of the raw trace bytes), and gzip removes most of that.
- **Tiers.** Only the full tier was run. The harness fixes the API to `D2RMM_ENV=staging` (`apiEnvironment`, `apiArgs`
  refuse anything else) because provisioning needs the staging endpoints, so a production run is not available without
  changing the harness. The attribute keys the production tier drops (BattleTag, character name, the OCR read text and
  names) are 522 bytes of the 327 488 span bytes captured (0.16%): the journey sends no agent readings, so the production
  tier would carry the same top 10 here. The real difference (what `lobby.record-observation` carries) needs a journey
  that posts readings.
- **Caveat.** A small local run, 25 players and about three minutes: absolute bytes are not comparable to the nightly
  (400 players, the 100-player step); shares are. At 0.1 sampling few traces were kept, so the long tail is thin. The
  wire total of this run was 98 631 bytes: traces 75 762 (77%), logs 16 508 (17%), metrics 6 361 (6%), against 78% / 21% /
  2% in the nightly.

**Traces: top 10 span names** (42 distinct names; wire share of 75 762 bytes).

| #   | Span name                   | Spans | Per room | Raw share | Wire share | Mean bytes | Heaviest attribute keys (bytes per span)                          |
| --- | --------------------------- | ----: | -------: | --------: | ---------: | ---------: | ----------------------------------------------------------------- |
| 1   | `pg.query:SELECT postgres`  |   264 |     13.9 |     18.6% |      22.1% |        377 | `db.query.text` 144, `server.address` 50, `db.system.name` 32     |
| 2   | `pg-pool.connect`           |   241 |     12.7 |     12.0% |      11.2% |        266 | `server.address` 50, `db.postgresql.idle.timeout.millis` 42       |
| 3   | `POST`                      |    50 |      2.6 |      2.9% |       6.0% |        306 | `url.path` 46, `server.address` 45, `network.protocol.version` 35 |
| 4   | `pg.query:INSERT postgres`  |    55 |      2.9 |      4.4% |       5.7% |        426 | `db.query.text` 193, `server.address` 50                          |
| 5   | `pg.query:UPDATE postgres`  |    67 |      3.5 |      4.5% |       5.3% |        360 | `db.query.text` 127, `server.address` 50                          |
| 6   | `pg.query:COMMIT postgres`  |    75 |      3.9 |      3.6% |       3.5% |        260 | `server.address` 50, `db.system.name` 32, `db.namespace` 28       |
| 7   | `agents.authenticate-agent` |    60 |      3.2 |      2.4% |       3.3% |        218 | `d2r.account.id` 58, `d2r.agent.id` 56                            |
| 8   | `platform.stream.deliver`   |    69 |      3.6 |      1.7% |       2.9% |        128 | `d2r.stream.kind` 27                                              |
| 9   | `pg.query:BEGIN postgres`   |    53 |      2.8 |      2.6% |       2.5% |        258 | `server.address` 50, `db.system.name` 32, `db.namespace` 28       |
| 10  | `pg.query:START postgres`   |    22 |      1.2 |      1.2% |       1.5% |        302 | `db.query.text` 70, `server.address` 50                           |

Grouped by origin, over all 42 names: **the `pg` auto-instrumentation (`pg.query:*` and `pg-pool.connect`) is 781 of the
1 198 spans (65%) and about 52% of the trace wire bytes** (39 320 of 75 762); the HTTP spans (`POST`, `GET`, `PATCH`) are
68 spans and 8%; the application's own spans (`agents.*`, `lobby.*`, `matchmaking.*`, `identity.*`, `platform.*`) are 349
spans and 20%. The three groups cover all 1 198 spans (781 + 68 + 349), so the remaining **20% of the wire bytes is not
a fourth origin**: it is the part no span name adds on its own, the request envelope (resource and scope, repeated once
per `ResourceSpans`) and the gzip savings the per-name marginals share, which do not add up to the total (see Two
measures). Per room that is 41 database spans, 4 HTTP spans and 18 application spans.

**Logs: all the records** (2 distinct names; wire share of 16 508 bytes). Every record is the pino request log: Fastify
writes one `incoming request` and one `request completed` per request it handles, from the scope
`@opentelemetry/instrumentation-pino`, at severity `info`, with no event name. The app logger has no skip rule
(`appLoggerOptions` sets no `disableRequestLogging` and no per-route level), so every request that reaches the API is
logged twice. The capture holds 68 `incoming request` and 63 `completed` records, 131 in all: the five without a
completion are most likely requests still open when the run ended (the event streams; not checked). The
358 requests of the run summary are k6's counter, not the API's log: they are not all API requests this run logged
and **the gap between 358 and 68 is not
explained by the code; it is an open question** for T12 (count the API's own requests in the same run to close it).
"Two records per request" therefore holds for the requests that reach the API's logger, not for the 358.

| #   | Log record (scope / severity / body) | Records | Per room | Raw share | Wire share | Mean bytes | Attribute keys (bytes per record) |
| --- | ------------------------------------ | ------: | -------: | --------: | ---------: | ---------: | --------------------------------- |
| 1   | pino / info / `request completed`    |      63 |      3.3 |     35.1% |      18.4% |        131 | `responseTime` 27, `reqId` 19     |
| 2   | pino / info / `incoming request`     |      68 |      3.6 |     29.6% |      12.5% |        102 | `reqId` 19                        |

The rest of the log bytes (35% raw) is the repeated resource and scope. Logs are not sampled, so they scale with request
count, not with the 0.1 trace ratio.

**Metrics: top 10 of 14** (2 exports; the wire share is not measured per metric, the raw share is of 34 074 bytes before
gzip, and the whole signal was 6 361 bytes on the wire): `http.server.response.body.size` 32.2%,
`http.server.request.duration` 32.1%, `db.client.operation.duration` 15.8%, `d2r.queue.wait` 2.9%,
`room.stage_duration` 2.9%, `d2r.room.time_to_active` 2.7%, `db.client.connection.count` 2.6%,
`db.client.connection.pending_requests` 1.4%, `d2r.room.final_stage` 1.2%, `db.client.connection.max` 1.2%. The three
histograms are 80% of the metric bytes, and one export carries them for every route and status.

**What this says (input for T12 and F3, not a decision).**

1. About half of the trace bytes, and about 40% of all telemetry bytes (39 320 of 98 631), are database auto-instrumentation: the query text
   (`db.query.text`, 70 to 190 bytes on every query span) and the three constant attributes that repeat on every `pg` span
   (`server.address`, `db.system.name`, `db.namespace`). The pool's `pg-pool.connect` span (12.7 per room) has no business
   attribute at all. These are the cheapest bytes to remove: dropping `pg-pool.connect`, the transaction-control spans
   (`BEGIN`, `COMMIT`, `START`) and `db.query.text` is a change to the instrumentation setup, not to the application.
2. The application's own spans are 20% of the trace wire bytes. The sampler decides how many traces are kept; this
   split says what each kept trace costs, and most of it is the `pg` spans.
3. The request log is the whole log signal: up to two records per request the API logs, about 120 bytes each, unsampled.
   A filter on the pino instrumentation (or logging requests at a lower level in the full tier) targets the log signal,
   which is 21% of the nightly's wire bytes and 17% in this run; how much it saves is not measured here.
4. The metrics are 2% of the nightly and have no single lever.

Reproduce: the commands above, then compare shares, not bytes.

## Production backend

The API (`d2rmm-api` on Render) exports its traces, metrics and logs over OTLP/HTTP to **Grafana Cloud** (ADR 013). The
site and the desktop agent export their spans too, through the API's relay (`/v1/telemetry/traces`): ADR 037 lifted AD-098
(production off), and what leaves in production is limited by the tier (see above), never a name or a read text. The
provider appears only in `apps/api/src/main/` (`config.ts` reads the environment), never in a module or in
`packages/telemetry`.

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
  measurement with gzip protobuf is in "Egress must be re-measured" above (81 000 bytes per player-hour, API alone, full
  tier, nightly run 45037822441); the 755 KB figure above is the older JSON, uncompressed one.
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
  parent. The agent exports in every release build (ADR 037 lifted AD-098), but production samples it at 10% and a span can
  be lost in transit, so a trace can still show without its root; on staging the agent samples 100%. The API spans of that
  trace are complete; only the agent's side can be missing. The `<op>` values are
  `request_code`, `claim`, `heartbeat`, `assignment`, `observation`, `ready_check`, `my_ready_check`, `characters` and
  `stream`.
- **Site requests** carry the `traceparent` of the site's span; the site exports too (ADR 037), under the same sampling
  caveat as the agent.
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
