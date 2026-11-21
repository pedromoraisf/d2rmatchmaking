# Observability tiers — Design

Spec: `spec.md` · ADRs: 037 (tiers), 032 (config in `main/`), 033 (build once), 027 (agent hexagon), 036 (read names).

## One tier value per app

```text
API    D2RMM_ENV ──main/config.ts──► tier ──► resource (deployment.environment, d2r.telemetry.tier)
                                         └──► SpanDetail port (application) ──► which attributes a use case sets
                                         └──► boot config `telemetryTier` ──► site
Agent  D2RMM_CHANNEL (compile time, app crate) ──► adapters::telemetry::tier_of(channel) ──► ExportConfig + sanitizer
Site   GET boot config ──► shared/telemetry.ts start(tier) ──► web exporter with redaction
```

`type TelemetryTier = 'full' | 'production'`. Unknown input → `production` everywhere (OBT-01).

## Where each piece lives

| Piece                                  | Place                                                                                       | Layer rule                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Staging-only key list, `redactForTier` | `packages/telemetry/src/redact-attributes.ts` (pure)                                        | no env read; the tier is an argument                    |
| Credential words (always dropped)      | same file, split from today's `FORBIDDEN_WORDS`; `battletag` moves to the staging-only list | OBT-11 unchanged                                        |
| API tier from `D2RMM_ENV`              | `apps/api/src/main/config.ts`                                                               | only `main/` reads the env                              |
| `SpanDetail` port                      | `apps/api/src/shared-kernel/tracing.ts` (interface) + implementation in `main/`             | application sets full-tier attributes only through it   |
| Boot config field `telemetryTier`      | `packages/contracts` (contract first) + the existing boot route                             | `openapi.json` regenerated                              |
| Agent tier                             | `adapters/src/telemetry/tier.rs` (pure `tier_of(channel)`), called from `src/app.rs`        | the app crate passes the channel string                 |
| Agent sanitizer by tier                | `adapters/src/telemetry/sanitize.rs`: `ALLOWED_ATTRIBUTE_KEYS` (both) + `FULL_TIER_KEYS`    | dropped unless the tier is full                         |
| Agent span fields                      | core steps that already hold the read result (room step, screen step), not the readers      | keep reading modules untouched where possible (rule 14) |
| Site tier, ids, notice                 | `apps/web/src/shared/telemetry.ts`, `app/` composition, i18n files                          | no hard-coded string (rule 9)                           |

## Redaction order

1. The use case or step sets attributes; full-tier attributes go through the tier (API `SpanDetail`, agent and site
   helpers), so a production process does not even build them.
2. The exporter redacts again by key with `redactForTier` / the sanitizer (defence in depth, OBT-08): a library span
   that carries a name under its own key is still dropped, since values matched against the known read names are
   dropped too in the API (the `name-leak-scan` harness finds them).
3. The relay forwards bytes unchanged (spec decision).

## Telemetry of this feature

No new span name. The API's existing spans gain the ids of OBT-03; `d2r.telemetry.tier` is a resource attribute, so a
TraceQL filter `{ resource.d2r.telemetry.tier = "full" }` separates staging from production.

## Risks

- **A reading module change for a span field** falls under rule 14 (real-print proof). Prefer recording the field in the
  caller that receives the read result. If a reading module must change, its PR carries the `ocr-real` and
  `ocr-variations` counts.
- **Volume**: 100% sampling on staging and agent/site spans in production grow telemetry egress; `telemetry.md` says the
  numbers must be re-measured by the nightly load run.
