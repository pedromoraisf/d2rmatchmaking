# Load baseline

The first measured load of the main journey (NFR-14). Measured on 2026-11-04 at commit `07da672` by `pnpm test:load`. The numbers come from `reports/load/summary.json` and are written by `pnpm load:publish`; do not edit them by hand.

## Numbers

| Measure                                                                               | Value       |
| ------------------------------------------------------------------------------------- | ----------- |
| Most simultaneous players held (`maxConcurrentPlayers`)                               | 400         |
| Most rooms in `created` at the end of that step (`maxConcurrentRooms`)                | 2455        |
| p95 state latency at 100 players, ms (`p95StateLatencyMs`)                            | 1.37618     |
| Bytes per player-hour at 100 players (`bytesPerPlayerHour`)                           | 113827      |
| Within the 70 000 bytes per player-hour budget (`withinEgressBudget`)                 | no          |
| Telemetry bytes per player-hour (`telemetryBytesPerPlayerHour`)                       | 754888      |
| Telemetry bytes a month at 100 players (`telemetryMonthlyBytes`)                      | 54351900000 |
| Telemetry share of the 5 GiB monthly budget, limit 0.10 (`telemetryShareOfBudget`)    | 10.1238     |
| Within the telemetry limit of 0.10, report-only in F0 (`withinTelemetryBudget`)       | no          |
| Relay allowance a month, reported beside the telemetry (`relayAllowanceMonthlyBytes`) | 503316000   |
| Ceiling of 400 players reached (`ceilingReached`)                                     | yes         |

Telemetry is report-only in F0 (AD-128): a share above 0.10 does not fail the run. Reducing telemetry is a condition of setting `OTEL_EXPORTER_OTLP_ENDPOINT` in production.

## Limits

| Limit                                  | Value |
| -------------------------------------- | ----- |
| API container CPUs (`LOAD_CPUS`)       | 0.5   |
| API container memory (`LOAD_MEMORY`)   | 512m  |
| k6 container memory (`LOAD_K6_MEMORY`) | 1500m |

## Versions

| Component        | Version                           |
| ---------------- | --------------------------------- |
| k6               | k6 v2.3.0 (go1.27.1, linux/amd64) |
| k6 SSE extension | xk6-sse v0.2.0                    |
| Node             | node:26-alpine                    |
| Postgres         | postgres:17-alpine                |
| API image        | d2rmm-load-api:f0                 |

## Steps

An error ratio is the errors over the journey requests plus the iterations of the measuring window. A step passes at a p95 of 2000 ms or less and an error ratio below 1%, with the API container still running.

| Players | p95 (ms) | Error ratio | Bytes received | Peak API CPU (%) | Peak API memory (bytes) | Result |
| ------- | -------- | ----------- | -------------- | ---------------- | ----------------------- | ------ |
| 25      | 1.87921  | 0           | 72760          | 10.02            | 124256000               | passed |
| 50      | 1.11014  | 0           | 147083         | 7                | 121215000               | passed |
| 100     | 1.37618  | 0           | 284565         | 24.34            | 128555000               | passed |
| 150     | 1.02798  | 0           | 422111         | 31.79            | 132645000               | passed |
| 200     | 1.10156  | 0           | 569626         | 32.09            | 143550000               | passed |
| 300     | 1.20678  | 0           | 845100         | 26.37            | 156343000               | passed |
| 400     | 1.22814  | 0           | 1130160        | 39.24            | 165151000               | passed |
