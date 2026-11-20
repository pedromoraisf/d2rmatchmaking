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
every path that takes a read name has a test with it.
