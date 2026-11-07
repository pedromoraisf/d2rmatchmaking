# Phase F0 — Brief revision 5

**Status**: APPLIED to `brief.md` on 2026-11-07. Approved by the maintainer: "aprovado por pedromoraisf", given with "revisado" and `/phase-run F0` in answer to the runner's plan for the span link (revision, approval, run).
**Why**: exit criterion 8 asks for one trace from the click to the stream with the agent linked. A room leaves two traces with no link between them (AD-092). At the review on 2026-11-07 the maintainer chose the span link and decided that F0 closes with it.

## 1. New feature row

| Feature         | Size   | Depends on          | Parallel | Covers          | Wall-clock |
| --------------- | ------ | ------------------- | -------- | --------------- | ---------- |
| room-trace-link | Medium | site-stale-read-fix | no       | NFR-09, ADR 013 | default    |

No new exit criterion. The feature completes criterion 8.

## 2. Scope of the feature (sketch for its Specify; the runner writes the requirement IDs)

- **Trace A** starts at the site's "Start test match" and ends at the delivery of the `awaiting_host` stage. **Trace B** starts at the agent's observation and ends at the delivery of `created` (`.specs/features/observability-e2e/design.md` § The two traces of a room).
- **Change**: when `lobby.on-match-formed` opens a room, the room keeps the W3C `traceparent` of the active context, in a new nullable column through a new migration. Rows written before it stay `null`. When `lobby.record-observation` runs for a room with a stored context, its span carries a span link to that context. A room with no stored context gets no link. Both traces stay as they are; B gains a link to A.
- **Boundaries**: the trace context is telemetry, not a domain rule. The domain stays free of OpenTelemetry (rule 1), and the design places the capture and the link in the application and adapter layers.
- **Proof**: unit tests on the use cases with an in-memory span exporter; the trace scenario of `observability-e2e` gains a check that trace B's `lobby.record-observation` span links to trace A, against the local `grafana/otel-lgtm` backend (AD-088).

## 3. Out of scope

- Contract, agent and site changes. The link is made in the API.
- The browser's receipt of the stream (AD-086).
- Turning telemetry on in production builds, the privacy notice and the telemetry volume: decided by the maintainer on 2026-11-07 for F1 (`decisions.md`).

## Approval

**Approved**: 2026-11-07 - user: "aprovado por pedromoraisf"
