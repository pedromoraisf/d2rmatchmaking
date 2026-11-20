# Delivery platform — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-delivery-platform` →
**`main`** (maintainer, 2026-11-20). After each merge, the orchestrator merges `main` into `phase/F2`.

Rules:

- One worker only, in series.
- `ci.yml`, `nightly.yml` and `ocr-real.yml` are never edited.
- Secrets and variables, GitHub environments, Render services and the Battle.net client are the maintainer's. Write
  the exact list and stop that task.
- Every batch ends in one PR into `main`.

## Batch 1 — target and API version (PR 1)

- [x] T1 — Write ADR 033 (Proposed) and `docs/engineering/delivery.md` from design.md. Record Render's answer on free
      prebuilt images, with the docs URL (DLP-01). Gate: `pnpm format:check`
- [x] T2 — The API answers its build SHA on `/healthz` and sets `service.version` (DLP-04). Cover it with unit and
      integration tests, regenerate the contract, and write the `@DLP-04` steps. Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch`
- [x] T3 — The site retries a sleeping API with a "waking the server" message for up to 90 s (DLP-07, site part). Add
      component tests, the strings in en and pt-BR, and the `@DLP-07` steps. Gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint && pnpm exec turbo run test:acceptance -- --grep @DLP-`

## Batch 2 — stages and the site (PR 2)

- [x] T4 — Write the reusable `stage-build`, `stage-deploy`, `stage-smoke` and `stage-promote` workflows and the thin
      `site.yml` (DLP-02, DLP-03). Make the preview origin deploy configuration, and add the fixed phase-preview alias
      (DLP-08). Write static harness tests (DLP-10). Gate: `pnpm test:harness`
- [x] T5 — Run the site through the new stages beside `deploy-web.yml` on three real pushes or PRs, and record the run
      links in the PR. Gate: `gh run list --workflow site.yml --limit 3 --json conclusion,url`

## Batch 3 — the API split (PR 3; the deploy to production waits for the maintainer's secrets)

- [x] T6 — `render.yaml` with `d2rmm-api` (staging) and `d2rmm-api-production`, each with every secret name as
      `sync: false`, `BNET_*` included (DLP-05). Write `api.yml` on the stages with migrations per environment, and
      update the `render.yaml` harness test. Gate: `pnpm test:harness`
- [x] T7 — `scripts/delivery/awake-window.mjs` with unit tests, and `keep-awake.yml` (DLP-07). Gate:
      `node --test scripts/test/awake-window.test.mjs && pnpm test:harness`
- [x] T8 — Write `docs/engineering/delivery.md § What the maintainer creates`: environments, the service, the Neon
      database, the Battle.net client and the secret names. Then stop until they exist. Gate: `pnpm format:check`

## Batch 4 — agent channels (PR 4)

- [ ] T9 — Channel config in the app crate: the identifier, product name, API base and updater per channel; the
      self-check line carries `channel` and `version` (DLP-06). Rust unit tests. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] T10 — `agent.yml` on the stages: a preview installer per agent PR and a staging installer per `main` commit, both
      as artifacts only, each smoke-started against its API. Harness tests. Gate: `pnpm test:harness`

## Batch 5 — remove what was replaced (PR 5)

- [ ] T11 — Once each replacement has passed three real runs (links in the PR), remove `deploy-web.yml`,
      `deploy-api.yml` and `preview-api.yml`, move `release-agent.yml` onto `stage-smoke` and `stage-promote`, and
      update the harness tests (DLP-09). Gate: `pnpm test:harness && pnpm format:check`
