# Staging bots — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` (T10) · Branch: `feat/F2-staging-bots` → `phase/F2`

Rules:

- **No server change.** If a task seems to need a route, a column or a flag in `apps/api`, stop and report (SBT-03).
- **No new secret.** If one seems needed, stop and name it (SBT-12, rule 6).
- Config is read only in `scripts/staging/config.mjs`; the libraries take values as arguments (rule 13).
- Reuse `scripts/load/lib/provision-requests.mjs` and the contract schemas; do not copy request builders.
- Tests first in each task. `.quality-baseline.json`, `ci.yml` and the sensors are not touched.
- Actions are pinned by full SHA, as the harness tests check.
- The script must stay out of `apps/*` and never import from `apps/api/src/main/`.

## Batch 0 — Verify what the draft assumes (no code; findings go in `decisions.md` of the feature)

- [x] T0 — Confirm the four assumptions the spec rests on, each with the file and line, and write the result in
      `.specs/features/staging-bots/notes.md`: (A1) how the match names the host (join order?) and what `GAME_NAME_SEEN`
      of a member does before `created`; (A2) a Battle.net display name never contains `-` (`displayNameOf`, BattleTag
      rules in the Battle.net docs the repo already cites); (A3) the staging rate limits (per IP, per agent) against 8
      bots from one runner IP, so SBT-08's back-off is the only mitigation needed; (A4) `GET /v1/config` is reachable
      without a session on staging and production. Gate: `pnpm specs:check`

## Batch 1 — The script

- [ ] T1 — `scripts/staging/lib/plan.mjs`: validates the dispatch inputs and returns the plan (group size 2 or 8,
      `bots` default and cap, `minutes` cap, names `bot-<tag>-<n>`, character names, the declared ladder and era)
      (SBT-01, SBT-04, SBT-06, SBT-08), including `human_first` and `host_policy`, and refuses the `teleporter` role. Gate: `node --test scripts/test/staging-bots-plan.test.mjs`
- [ ] T2 — `scripts/staging/lib/target.mjs`: `assertStaging({ apiUrl, expectedUrl, environment, fetch })` refuses a wrong
      origin, `stagingEndpoints:false`, `D2RMM_ENV=production`, and an unreachable `/v1/config`, with no request but
      `/healthz` and `/v1/config` (SBT-02). Cover every refusal with a production-shaped fake API. Gate:
      `node --test scripts/test/staging-bots-target.test.mjs`
- [ ] T3 — `scripts/staging/lib/bot.mjs`: one bot's lifecycle over the real contract (test-login, pair, claim, register
      character, heartbeat, site and agent streams with reconnect, join, accept, observe, leave) (SBT-05, SBT-07).
      Bodies are validated with `@d2rmm/contracts` before they are sent. Gate:
      `node --test scripts/test/staging-bots-bot.test.mjs`
- [ ] T4 — `scripts/staging/lib/cleanup.mjs`: the four leave steps in order, each failure logged and the rest still run,
      exit code from the failures; and `lib/log.mjs`: structured log lines and the job summary that hold no token or
      cookie (SBT-10, SBT-11). Gate: `node --test scripts/test/staging-bots-cleanup.test.mjs`
- [ ] T5 — `scripts/staging/config.mjs` (the only reader of `process.env`) and `scripts/staging/bots.mjs` (the CLI:
      config → `assertStaging` → plan → bots → wait for the room to end or the time to pass → cleanup on every exit
      path, SIGINT and SIGTERM included) (SBT-02, SBT-08, SBT-10). Gate:
      `node --test scripts/test/staging-bots-cli.test.mjs`

## Batch 2 — Proof against the real app

- [ ] T6 — API integration test `apps/api/src/main/__tests__/staging-bots.int.test.ts`: starts the real app with
      `stagingEndpoints: true`; one bot and one test player form a duel, the bot accepts, posts its observation, the room
      reaches `active`, the bot leaves, and no token of the run authenticates after (SBT-05, SBT-06, SBT-07, SBT-10).
      A second case starts 7 bots for a Leveling group with a test player. Gate:
      `pnpm --filter @d2rmm/api test:integration -- staging-bots`
- [ ] T7 — Production proof: an integration test that builds the app with `stagingEndpoints: false` and shows 404 on
      `/v1/auth/test-login` and `/v1/staging/match-formed`; a unit test that `refusalOf` refuses
      `ENABLE_STAGING_ENDPOINTS=true` outside `D2RMM_ENV=staging`; the route table lists every staging-only route and
      fails on an unlisted one (SBT-03). Gate: `pnpm --filter @d2rmm/api test:integration -- staging-bots-production`
      and `pnpm --filter @d2rmm/api test -- render`

## Batch 3 — Site, workflow, docs

- [ ] T8 — Site: `isBotName` in `apps/web/src/shared`, the "Bot" badge wherever a display name shows, with en and pt-BR
      strings (SBT-09, rule 9). Test first: component tests for the queue, ready-check and room members. Gate:
      `pnpm --filter @d2rmm/web test`
- [ ] T9 — `.github/workflows/staging-bots.yml` and its harness test (inputs, environment `staging`, no `secrets.`,
      `contents: read`, pinned actions, `timeout-minutes`, `concurrency` with `cancel-in-progress: false`, the job
      summary step) (SBT-01, SBT-08, SBT-12). Gate: `pnpm test:harness`
- [ ] T10 — `acceptance.feature` with the `@SBT-09` scenario and the bot round on the acceptance stack (`@SBT-05`,
      `@SBT-06`, `@SBT-07`, `@SBT-10`), step definitions in `tests/acceptance/steps/`, and the coverage check. Gate:
      `pnpm test:acceptance --grep @SBT && pnpm acceptance:check`
- [ ] T11 — `docs/engineering/staging-bots.md`: dispatch from the phone, the inputs, how a run reads, how to stop one,
      and the statement that the bots exist only on staging (SBT-13). Link it from `docs/engineering/delivery.md`. Gate:
      `pnpm specs:check && pnpm lint`

## Review

- [ ] T12 — Security review of the spec's threat model and of the diff before the PR merges (ADR 029). The gate is the
      reviewer's verdict: `VERDICT PASS`.
