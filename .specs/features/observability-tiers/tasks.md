# Observability tiers — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-observability-tiers` → `phase/F2`

Rules:

- One PR for the feature into `phase/F2`. `acceptance.feature` reaches the phase branch only inside that PR, with its
  steps (lessons: `missingSteps: 'fail-on-gen'`).
- `CARGO` = `cargo` in `apps/agent/src-tauri`. The Windows app crate (`d2rmm-agent`) is proven by CI (`agent`,
  `agent-build`); a Linux session cannot build it.
- Contract first: a change to the boot configuration regenerates and commits `openapi.json` (rule 2).
- A reading module (`scripts/agent/reading-modules.json`) is not changed unless a field cannot be set elsewhere; then
  rule 14 applies and the PR carries the `ocr-real` / `ocr-variations` counts.
- The gate commands below are the forms used by earlier F2 tasks. If one does not run as written, fix the command in
  this file in the same commit and say so in the report.
- Traced scenarios run alone with one worker (lessons): `--workers=1`.
- No mutation in a gate (ADR 029). No sensor, ESLint, dependency-cruiser or baseline is relaxed (rule 4).

## Batch 1 — the shared package, the API and the site

- [x] T1 — `packages/telemetry`: `TelemetryTier`, the staging-only key list (OBT-04, OBT-06, OBT-07 keys) and a pure
      `redactForTier(attributes, tier)`; split `FORBIDDEN_WORDS` into credential words (dropped in every tier, OBT-11) and
      personal words (`battletag`, dropped in production only); the redacting exporters take the tier. Unit tests: every
      staging-only key dropped in production and kept in full; every credential word dropped in both (OBT-08, OBT-11).
      Gate: `pnpm --filter @d2rmm/telemetry test`
- [x] T2 — API tier (OBT-01, OBT-02): `main/config.ts` maps `D2RMM_ENV` (`staging`, `local` → full; `production`, other →
      production); resource gets `deployment.environment` and `d2r.telemetry.tier`; contract first, the boot configuration
      gains `telemetryTier`; regenerate `openapi.json`. Unit tests on the mapping and the resource.
      Gate: `pnpm contracts:openapi && pnpm --filter @d2rmm/contracts test && pnpm --filter @d2rmm/api test`
- [x] T3 — API ids and game data on spans (OBT-03): `d2r.account.id`, `d2r.agent.id`, `d2r.room.id`, `d2r.run.id`,
      `d2r.ticket.id`, `d2r.ready_check.id`, `d2r.game.name`, `d2r.difficulty`, `d2r.queue.mode`, `d2r.room.stage` where
      each use case knows them (journey table in `telemetry.md`); the attribute builders are pure functions with unit
      tests (lessons: extract and unit-test). No metric gains an id label. Gate: `pnpm --filter @d2rmm/api test`
- [x] T4 — API full-tier fields (OBT-04, OBT-09): a `SpanDetail` port (shared-kernel interface, implementation in `main/`
      from the tier) through which use cases set `d2r.account.battletag`, `d2r.character.name`,
      `d2r.observation.read_text`, `d2r.observation.read_names`; `name-leak-scan` runs its scenarios in both tiers
      (production: no name anywhere; full: names only in spans and logs, never in rows, outbox, events or answers);
      update `docs/engineering/telemetry.md` § "Names read on screen" for the staging exception.
      Gate: `pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:integration`
- [x] T5 — Site (OBT-01, OBT-07, OBT-12): telemetry starts in every build with the tier from the boot configuration
      (unknown → production); spans carry the ids; the BattleTag only in full; the exporter redacts with `redactForTier`;
      a recording notice on every page in the full tier, en and pt-BR. Component and unit tests.
      Gate: `pnpm --filter @d2rmm/web exec vitest run src/shared src/app && pnpm --filter @d2rmm/web lint`
- [x] T6 — Acceptance steps for `@OBT-01`, `@OBT-03`, `@OBT-04`, `@OBT-12` (a staging API and a production API in the
      stack; traces read from the local backend by trace id, lessons). Gate:
      `pnpm exec turbo run test:acceptance -- --grep @OBT- --workers=1`

## Batch 2 — the agent, the source rule and the docs

- [x] T7 — Agent tier (OBT-01, OBT-02, OBT-05): `adapters/src/telemetry/tier.rs` with a pure `tier_of(channel)`
      (`preview`, `staging` → full; `production`, none, unknown → production); `src/app.rs` builds `ExportConfig` in every
      release build (AD-098 lifted, the `D2RMM_TELEMETRY` switch removed), `deployment.environment` = the channel, ratio
      1.0 in full; resource gets `d2r.telemetry.tier`. Unit tests on `tier_of`.
      Gate: `CARGO nextest run -p d2rmm-agent-adapters --lib && CARGO clippy --all-targets -- -D warnings`
- [x] T8 — Agent sanitizer by tier (OBT-05, OBT-06, OBT-08, OBT-11): the production allow-list gains the ids, the game
      name, confidence, correction classes and timings; `FULL_TIER_KEYS` (`d2r.ocr.text`, `d2r.ocr.names`, character names)
      pass only in full; the fixed vision words stay. Unit tests: every key in both tiers, events/links/status text still
      dropped. Gate: `CARGO nextest run -p d2rmm-agent-adapters --lib`
- [x] T9 — Agent span fields (OBT-05, OBT-06): the core steps that hold a read result record the ids, game name,
      screen, capture method, confidence, corrections and timings, and the full-tier text and names; unit tests with
      fakes on the recorded fields. Prefer callers over reading modules (design § Risks).
      Gate: `CARGO nextest run -p d2rmm-agent-core --lib && CARGO clippy --all-targets -- -D warnings`
- [x] T10 — Source rule (OBT-10): a harness test fails when an agent or site source sets a staging-only key outside the
      module that applies the tier; one fixture that breaks it, one that passes. Gate: `pnpm test:harness`
- [x] T11 — Docs (OBT-13): `docs/engineering/telemetry.md` — one table per app of what each tier carries, the "Production
      backend" section updated (AD-098 lifted by ADR 037), how to follow a journey by `d2r.room.id`, `d2r.account.id`,
      `d2r.ticket.id`, and the egress re-measure note. The orchestrator runs the TraceQL query on `grafanacloud-traces`
      once after staging deploys and fills the result. Gate: `pnpm format:check && pnpm specs:check`
