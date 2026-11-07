# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - When a privacy rule drops personal data, list every attribute key a library can carry it under and test each one, not only the key the spec names

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `telemetry` · harmful: 0
- features: observability-e2e
- evidence: verification.md finding 1; C38 (telemetry)
- last seen: 2026-11-03T19:09:32Z

### L-002 - Extract a request-validation decision into a pure function and unit-test its boundaries, so a boundary mutation is killed without the assembled service

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `api-platform` · harmful: 0
- features: observability-e2e
- evidence: verification.md finding 2; telemetry-relay admit (api-platform)
- last seen: 2026-11-03T19:09:32Z

### L-003 - When a design revision changes what a spec rule counts, change the spec's text in the same commit, so the rule the tests pin is the rule the spec states

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: load-baseline
- evidence: scripts/load/lib/error-ratio.mjs:43 (spec)
- last seen: 2026-11-04T13:16:22Z

### L-004 - When an assumption fixes how a flag or mode is treated, test the off value too: tracers in tests sample by default, so only flags 01 ever ran.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/api tracing` · harmful: 0
- features: room-trace-link
- evidence: mutations.json: unsampled context not stored (AD-135) (apps/api tracing)
- last seen: 2026-11-07T22:05:25Z

### L-005 - Fill a markdown table's Closed cell by rebuilding the row from its cells and checking the cell count, never by string surgery on the line end.

- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `.specs verification.md` · harmful: 0
- features: room-trace-link
- evidence: gate:room-trace-link/verification attempt 3 (.specs verification.md)
- last seen: 2026-11-07T22:05:25Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
