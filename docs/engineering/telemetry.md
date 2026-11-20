# Telemetry

OpenTelemetry in all three apps from day 0 (ADR 013). Export is OTLP; the backend (Grafana Cloud in the MVP) is
configured only in `apps/api/src/main/` and the apps' bootstrap via env.

- **Traces**: one trace from the site click → API → Postgres → outbox → SSE event; the agent's spans link via
  `traceparent` on heartbeat/observation requests. Span names: `<context>.<use-case>` (e.g. `lobby.record-observation`).
- **Metrics**: queue wait by difficulty, ready-check acceptance, rooms reaching `active`, agent read rate,
  SSE connections, **egress bytes per player-hour**, Neon CU usage, outbox lag.
- **Logs**: structured JSON with trace id; never tokens, cookies, raw images or full chat lines.
- Attributes: bounded cardinality (difficulty, mode, region, stage). No account ids on metrics.

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
