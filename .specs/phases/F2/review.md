# Phase F2 — review

> **DRAFT.** Drafted 2026-11-22 on `phase/F2` @ `6e75f3cf` by a feature worker for the orchestrator, who finishes it after the
> open PRs merge. Every figure carries the SHA it was measured on; `TBD (after merge queue)` marks a number that depends on
> unmerged work. The approval line is the maintainer's and stays empty.

## Verdict

Not ready for approval. Of the 16 exit criteria at drafting: 4 are met (remote configuration in code, agent lifecycle,
privacy and token, upkeep); assisted typing is met once #155 merges; 3 have code ready and a field or evidence step open
(OCR protection, character and screen reading, chat); 3 wait on the maintainer's game PC (read rate 0 of 20 real rooms,
robustness NFR-03, performance NFR-02 CPU); load is partly met (bytes at the ratchet, run green, ratchet red on the
nightly's mutation metrics); and 3 are not met: the nightly (three green nights on `main` still to come, mutation jobs red
at `431fa30`), delivery (production is the maintainer's) and releases (0.4.0 runs after the phase PR merges; SignPath
waits). The decisions to confirm are in `decisions.md` (55 rows).

## Exit criteria

Measured on `phase/F2` @ `6e75f3cf` unless another SHA is named. "Field" means the maintainer's game PC. Criteria text is
the brief's, with Revisions 1–4 applied.

| Criterion                                                              | Status                                            | Proof                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nightly green and readable                                             | **Not met** (needs 3 green nights on `main`)      | Run 45037822441 on `phase/F2` @ `431fa30`: `acceptance` success, `load` success, `api-mutation` success, `agent-mutation` core / adapters / domain **failure or cancelled**, `quality` failure, `report` success. Fixes: #165 (shards), #161 and #168 (ratchet). Needs #163 on `main`. Three-night proof: TBD (after merge queue) |
| OCR reading logic protected (rule 14)                                  | **Code ready; evidence pending**                  | Rule in `AGENTS.md` and `.claude/agents/feature-worker.md` (#89); `reading-modules.json` extended (decisions row 25). Survivors: core 5 at `431fa30`, to be killed by #161 and #167; the exclusions harness test is in `pnpm test:harness`. Final survivor count: TBD (after merge queue)                                         |
| Read rate (Revision 3): zero wrong, ≥95 % of ≥20 real rooms confirmed  | **Waiting on field**                              | Field log: **0 of 20** real rooms logged (`game-name-reading` T13, T14 open). `ocr-variations` ratchet on `phase/F2`: correct floor 5727, wrong ceiling 45 (`.quality-baseline.json` @ `6e75f3cf`, `node scripts/quality-ratchet.mjs`). `ocr-real` 12/12 as of #104                                                               |
| Character and screen reading (scenarios, unit tests; 95 % moved to F3) | **Code ready; field step pending**                | `screen-recognition` tasks 10 of 16 boxes done (6 open: T9, O1, O2, T12, T13, T14). #142 pt-BR screens, #149 other client sizes, #150 CPU cost; T17 guard in #154 (open). Field matrix T12 and CPU T14 wait on the game PC                                                                                                        |
| Chat joined / left                                                     | **Code ready; field step pending**                | #107 (reading), #127 (agent posts names), #101 (API match). `game-name-reading` T13–T15 open (live rooms, field log, fixes)                                                                                                                                                                                                       |
| Robustness NFR-03                                                      | **Waiting on field**                              | `capture-cascade` 4 open boxes (T13 field matrix, T14 screen-crop if needed, T15 CPU and FPS, T16 fixes); cascade merged in #109                                                                                                                                                                                                  |
| Performance NFR-02 (CPU < 2 % over 30 min)                             | **Waiting on field**                              | `cpu-fallback.md` (#150) bounds the fallback cost by assumption only; no field CPU session yet. `screen-recognition` T14, `capture-cascade` T15                                                                                                                                                                                   |
| Assisted typing (Revision 4: none in the agent)                        | **Met when #155 merges**                          | Site copy button unchanged; typing removal in **#155 (open)**; `assisted-typing` `tasks.md` on `phase/F2` is stale (11/11 ticked for the discontinued typing). Source-rule test "agent sends no input": TBD (after merge queue)                                                                                                   |
| Privacy and token (NFR-04, NFR-06)                                     | **Met**                                           | #94 (agent-trust, 10/10); decisions rows 24 and 42 (9 agent routes against NFR-06's 3, maintainer to confirm). Consent notice and switch: **#156 (open)**                                                                                                                                                                         |
| Remote configuration                                                   | **Met in code; field check pending**              | #112, #128, #139, #160 (open), #134 docs; `remote-config` 27 of 28 boxes, T20 (field check on a per-PR installer) open                                                                                                                                                                                                            |
| Agent lifecycle in window and site                                     | **Met**                                           | #83 and #144 (agent-room-lifecycle 12/12); `@FR-05`/`@FR-16` scenarios in the acceptance suite (green in nightly 45037822441)                                                                                                                                                                                                     |
| Delivery platform (ADR 033)                                            | **Not met** (production and agent promotion open) | #113 site, #136 agent through `stage-smoke`, #157 staging follows `phase/**`; `delivery-platform` 12 of 13 boxes (T11b-2 open, a design decision). Production service, Neon and Battle.net client are the maintainer's ("Vou fazer"). Run links per app and environment: TBD (after merge queue)                                  |
| Load (Revision 4: 100 players, 0 errors, bytes ≤ ratchet ceiling)      | **Partly met**                                    | Nightly 45037822441 `load` success. Bytes per player-hour **405,334** against ceiling **447,000** (`.quality-baseline.json` @ `6e75f3cf`); NFR-14's 125,000 target moved to F3. Max players 400 (baseline), p95 27.7 ms. Fresh load run: TBD (after merge queue)                                                                  |
| Releases (agent 0.4.0 through the draft flow, `--self-check --online`) | **Not met**                                       | #111 (publish after sign, policy page). `agent-release` 5 of 12 boxes open: T8 0.4.0 after the phase PR merges; T9–T12 wait on SignPath (the maintainer applies)                                                                                                                                                                  |
| Upkeep (Dependabot PRs, #77/#80/#81 items)                             | **Met**                                           | #98, decisions "Upkeep" table (11 PRs, each done, closed or left to delivery-platform); `upkeep` 15/15. #153 (url bump) merged; TypeScript 7 and secretlint 14 deliberately not taken (row 49)                                                                                                                                    |

## Features

Fix rounds come from each merged PR body's "Fix rounds" line. A dash means the body has no such line.

| Feature              | PR                                           | Fix rounds  | Notes                                                                                                                       |
| -------------------- | -------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| nightly-report       | #85 (+ #89 baseline, #158, #165, #172 open)  | 5 (batch 2) | 7/7 tasks; mutation job red on the first phase nightly; fixes in flight                                                     |
| delivery-platform    | #84, #113, #136, #157                        | 1 (#157)    | 12/13; T11b-2 is a design decision (row in "Waiting on the maintainer")                                                     |
| ocr-protection       | #89                                          | 1           | 9/9                                                                                                                         |
| agent-room-lifecycle | #83, #144                                    | 0, 1        | 12/12                                                                                                                       |
| screen-recognition   | #93, #104, #120, #132, #142, #146, #149–#150 | 5 (#93)     | 10 of 16 boxes; #154 (T17 guard) open; field matrix and CPU waiting                                                         |
| server-name-match    | #101, #127                                   | —           | 12/12                                                                                                                       |
| game-name-reading    | #107, #126, #130, #133                       | 1 (#107)    | 14 of 17 boxes; T13–T15 are the field log                                                                                   |
| capture-cascade      | #109, #117                                   | 0           | 13 of 17 boxes; field matrix, CPU and fixes open                                                                            |
| assisted-typing      | #108 (merged), #155 (open, removal)          | 1 (#108)    | Discontinued by Revision 4; #145 closed; `tasks.md` still shows the typing tasks ticked                                     |
| agent-trust          | #94                                          | —           | 10/10                                                                                                                       |
| remote-config        | #112, #128, #134, #139, #160 (open)          | 0           | 27 of 28 boxes; T20 field check                                                                                             |
| stream-egress        | #99, #110, #122                              | 0           | 9/9; bytes 429,398 → 405,334 (−5.6 %), target moved to F3                                                                   |
| upkeep               | #98                                          | 0           | 15/15                                                                                                                       |
| agent-release        | #111                                         | 0           | 7 of 12; T8 after the phase merges, T9–T12 SignPath                                                                         |
| observability-tiers  | #148, #159, #143 (ADR 037); #156 (open)      | 0 (#148)    | `tasks.md` holds T1–T11 (11/11); the consent work (OBT-14..17, Revision 4) has no task rows on `phase/F2` until #156 merges |
| staging-bots         | #123                                         | —           | `tasks.md` 12 ticked, none open; not listed in `phase:status`                                                               |

`node scripts/phase-status.mjs` @ `6e75f3cf` reports `next = review` and counts per feature (nightly-report 7/7, delivery-platform
12/13, ocr-protection 9/9, agent-room-lifecycle 12/12, screen-recognition 10/14, server-name-match 12/12, game-name-reading
12/15, capture-cascade 12/16, assisted-typing 11/11, agent-trust 10/10, remote-config 26/27, stream-egress 9/9, upkeep
15/15, agent-release 7/12, observability-tiers 11/11). It counts only top-level task lines, so sub-items differ from the real
open boxes above (`grep -c '^\s*- \[ \]'` per `tasks.md`: screen-recognition 6, game-name-reading 3, capture-cascade 4,
remote-config 1, delivery-platform 1, agent-release 5). It omits `staging-bots` and treats `assisted-typing` as complete.

Open PRs into `phase/F2` at drafting time (`gh api 'repos/pedromoraisf/d2rmatchmaking/pulls?state=open&base=phase/F2'`):

| PR   | Branch                              | What                                                             |
| ---- | ----------------------------------- | ---------------------------------------------------------------- |
| #172 | chore/F2-mutation-upkeep            | line-independent mutation exclusions and nightly cache guard     |
| #171 | test/F2-api-application-survivors-2 | kill matchmaking and lobby-room application survivors            |
| #170 | test/F2-api-application-survivors-1 | kill agents and identity application survivors                   |
| #169 | docs/F2-decisions-11                | nightly mutation decisions and two lessons                       |
| #168 | test/F2-api-domain-survivors        | kill or remove api-domain survivors (ratchet)                    |
| #167 | test/F2-domain-survivors            | kill agent-domain survivors (rule 14)                            |
| #166 | docs/F2-egress-remeasure            | re-measure telemetry egress from the nightly load                |
| #165 | fix/F2-nightly-mutation-shards      | adapters in place, domain in four shards                         |
| #164 | fix/F2-acceptance-reset-503         | stop stream leftover work before the acceptance reset truncates  |
| #161 | test/F2-core-survivors              | kill agent-core survivors (rule 14)                              |
| #160 | feat/F2-remote-config-6             | build the configured chat pack once per config version (rule 14) |
| #158 | fix/F2-mutation-baseline            | isolate the closed-panel span test                               |
| #156 | feat/F2-telemetry-consent           | diagnostics notice and switch (OBT-14..17)                       |
| #155 | feat/F2-assisted-typing-removal     | remove assisted typing                                           |
| #154 | feat/F2-screen-recognition-8        | bound the pt-BR fallback on Unknown frames (T17)                 |
| #151 | fix/F2-review-followups-2           | other-game span, proxy record test                               |
| #150 | feat/F2-screen-recognition-7        | CPU cost of the pt-BR fallback pack                              |
| #149 | feat/F2-screen-recognition-6        | pin every screen at other 16:9 / 16:10 sizes                     |

Open count at drafting: 18. Merged into `phase/F2`: 59 (`pulls?state=closed&base=phase/F2`, `merged_at` not null). Re-run the
query before finishing; the merge queue changes both.

## Decisions to confirm

From `decisions.md → To confirm` (55 rows). The ones that change a stated requirement or a repository setting:

- **NFR-06 names 3 agent routes, the code has 9** (rows 24, 31, 42). The PRD wording is the maintainer's.
- **Phase pushes deploy staging with repository-level secrets** (row 58): a ruleset or a `staging` environment with a
  deployment-branch policy is a repository setting. Migrations must be expand-only meanwhile (row 59).
- **Keep-awake window 16:00–02:00 São Paulo instead of 24/7** (row 9); **promotion to production without a reviewer** (row 10).
- **Load ceiling and baseline** 447,000 / 405,300 (row 20) against NFR-14's 70,000; the 125,000 target moved to F3.
- **Agent telemetry consent** answered 2026-11-22 (row 52); an unset `D2RMM_ENV` means production since #159 (row 53).
- **`screen-recognition` follow-ups**: pt-BR fallback doubles OCR calls on frames unknown in both languages (rows 51, 55);
  field CPU session decides whether the T17 guard (#154) is enough.
- **Other client sizes proven only on drawn fixtures** (row 54); ultrawide and 4:3 move to F3.
- **`url` 2.5.9 lockfile bump, never an ignore entry** (row 57); TypeScript 7 and secretlint 14 not taken (row 49).
- Rows added after this draft: TBD (after merge queue; #169 adds the nightly mutation decisions).

## Blocked and deferred

- **Blocked** (`decisions.md → Blocked`): both rows are resolved (#104 raised the wrong ceiling to 45; #116 sharded
  `ocr-variations`). New blocker candidates: the nightly mutation jobs (agent core / adapters / domain red or cancelled at
  `431fa30`), fixed by #165, #161, #167, #168.
- **Waiting on the maintainer** (`decisions.md → Waiting on the maintainer`): SignPath application and roles; the
  `staging-bots` "Run workflow" button until the workflow reaches `main`; T11b-2 design decision; field matrix,
  live rooms and CPU session on the game PC; production Render service, Neon, Battle.net client and secrets.
- **Deferred to F3**: the 95 % synthetic-variation share (game name, popups, selection screens), the 125,000 bytes target,
  ultrawide and 4:3 support, and the Game Creator filling (out of scope, ADR 010).

## Quality

| Metric                                          | Baseline                                                 | Now                                                                                                       | Source                                                                    |
| ----------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| mutation api domain (%)                         | 100                                                      | 97.58 @ `431fa30`; after #168: TBD (after merge queue)                                                    | nightly run 45037822441 (`pnpm test:mutation`)                            |
| mutation api application (%)                    | 78.67                                                    | 78.75 @ `431fa30`; after #170, #171: TBD (after merge queue)                                              | nightly run 45037822441                                                   |
| mutation agent core (%)                         | 100                                                      | 97.25, 5 survivors @ `431fa30`; after #161: TBD (after merge queue)                                       | nightly run 45037822441 (`pnpm test:mutation:agent`)                      |
| mutation agent domain (%)                       | not a ratchet metric (row 12)                            | 98.97 @ `431fa30` (domain shards timed out at 60 min); after #165, #167: TBD (after merge queue)          | nightly run 45037822441                                                   |
| mutation agent adapters                         | not a ratchet metric                                     | baseline failed at `431fa30`; fixed by #165; now: TBD (after merge queue)                                 | nightly run 45037822441                                                   |
| CI duration (s)                                 | 588 (ceiling 900)                                        | `ci` on `phase/F2` @ `6e75f3cf`: success (run on 2026-11-22 17:47Z); duration TBD (after merge queue)     | `gh api 'repos/pedromoraisf/d2rmatchmaking/actions/runs?branch=phase/F2'` |
| load: max players / bytes per player-hour / p95 | 400 / 405,334 (ceiling 447,000) / 27.7 ms (ceiling 2000) | Nightly `load` job success @ `431fa30`; the figures are the baselines; fresh run: TBD (after merge queue) | `pnpm test:load` (nightly)                                                |
| ocr.variations correct / wrong                  | 5727 floor / 45 ceiling                                  | at the floor and ceiling per `.quality-baseline.json` @ `6e75f3cf`; nightly count TBD (after merge queue) | `ocr-variations` ratchet                                                  |
| acceptance failed / flaky                       | 0 / 0                                                    | 0 failed (job success) @ `431fa30`; scenario counts TBD (after merge queue)                               | nightly run 45037822441                                                   |

Local gate results on this checkout (`phase/F2` @ `6e75f3cf`, Node 26.13.1):

| Command                                                                                                            | Result                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                                                                                                | pass                                                                                                                                                                                 |
| `pnpm lint`, `pnpm typecheck`, `pnpm arch`                                                                         | pass (turbo cache used for part of them)                                                                                                                                             |
| `pnpm test` (turbo, 9 workspaces)                                                                                  | pass; 3 of 9 from cache                                                                                                                                                              |
| `pnpm specs:check`                                                                                                 | pass (`specs-check: OK`, `acceptance-check: OK`, 35 features)                                                                                                                        |
| `pnpm quality:reports`, `pnpm quality:collect`, `pnpm quality:ratchet --context pr --current reports/quality.json` | pass: `arch.violations` 0, `lint.warnings` 0, `tests.skipped` 0                                                                                                                      |
| `pnpm quality:ratchet --context phase --current reports/quality.json`                                              | **fails with 8 "sensor stopped reporting"**: the mutation, load and acceptance metrics need the nightly's artifacts, which a local run does not produce. Not a regression of a value |
| `pnpm quality:ratchet --context phase` (without `--current`)                                                       | fails 11 the same way (nothing collected); the two commands differ only in what was collected                                                                                        |

The `pnpm quality:gate` composite in `pnpm check` was run by its parts, as above. The Rust (`cargo nextest`, clippy), integration,
acceptance and e2e suites were not run here; their proof is CI's `ci` run on `6e75f3cf` (success) and the nightly.

## Lessons added

`docs/engineering/lessons.md` gains lessons from this phase; the orchestrator lists them from `git log --diff-filter=M -p
origin/main..phase/F2 -- docs/engineering/lessons.md` when it finishes the draft, and adds those of #169 once merged: TBD
(after merge queue).

## Approval

<!-- **Approved**: <date> - user: "<maintainer's words>" -->
