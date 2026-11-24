# Phase F2 — review

> **DRAFT.** Updated 2026-11-23 on `phase/F2` @ `a8539ac2` (after #200) by the orchestrator. Every figure carries the run or
> SHA it was measured on. `Maintainer` marks a step only the maintainer can do. The approval line is the maintainer's and
> stays empty.

## Verdict

Code complete; not ready for approval until the maintainer's steps are done. Of the 16 exit criteria:

- **6 are met**: OCR protection, assisted typing (removed, Revision 4), privacy and token, remote configuration in code,
  agent lifecycle, upkeep.
- **Load is met** for Revision 4: 400 players, 0 errors, bytes at the ratchet.
- **The nightly is green on `phase/F2`** (runs 45136543045 and 45205616909). The criterion asks for 3 green nights on `main`, which can
  only start after the phase PR merges.
- **5 wait on the maintainer's game PC**: read rate (0 of 20 real rooms), character and screen reading, chat,
  robustness NFR-03 and performance NFR-02.
- **2 wait on the maintainer's accounts**: the delivery platform (production service, Neon, Battle.net client, staging
  secrets) and releases (0.4.0 after the phase merges; SignPath).

`phase-status` reports one open runner task: `observability-tiers` T12 (egress of the agent and site). It needs a staging
trace sample, so it waits on the staging secrets. All other open boxes wait on the field.

## Exit criteria

Measured on `phase/F2` @ `6f758ec8` unless another run or SHA is named. "Field" means the maintainer's game PC. The
criteria text is the brief's, with Revisions 1–4 applied.

| Criterion                                                              | Status                                              | Proof                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nightly green and readable                                             | **Green on `phase/F2`; 3 nights on `main` to come** | Runs 45136543045 @ `0d208e50` and 45205616909 @ `a8539ac2`: every job success (acceptance 358 passed, load, api and agent mutation, quality `OK — 1 improvement`, report). Agent mutation 0 missed, 0 timeouts. The fixes were #165, #183, #184, #187, #192, #193 and #194. Three green nights on `main` start after the phase PR merges              |
| OCR reading logic protected (rule 14)                                  | **Met**                                             | Rule in `AGENTS.md` and `.claude/agents/feature-worker.md` (#89); `reading-modules.json`; agent-core and agent-domain 0 missed in run 45136543045; exclusions carry `Evidence:` lines (#172). `ocr-variations` on every reading-module PR: floor 5727 correct / ceiling 45 wrong                                                                      |
| Read rate (Revision 3): zero wrong, ≥95 % of ≥20 real rooms confirmed  | **Maintainer: field**                               | Field log **0 of 20** real rooms (`game-name-reading` 3 open boxes). Runbook `docs/field/F2-field-test.pt-BR.md`. Installer: run 45093039829, artifact `agent-preview-cc838428…` (includes #156)                                                                                                                                                      |
| Character and screen reading (scenarios, unit tests; 95 % moved to F3) | **Code ready; Maintainer: field**                   | `screen-recognition` 16/19 (3 waiting on field: field matrix, CPU, print fixes). #142, #149, #150, #154; T9 closed with no reading-module change (#180)                                                                                                                                                                                               |
| Chat joined / left                                                     | **Code ready; Maintainer: field**                   | #107, #127, #101 (API match). `game-name-reading` 14/17; T13–T15 are live rooms and the field log                                                                                                                                                                                                                                                     |
| Robustness NFR-03                                                      | **Maintainer: field**                               | `capture-cascade` 13/17 (4 waiting on field: matrix, screen-crop if needed, CPU and FPS, fixes); #192 bounded the cascade's loops                                                                                                                                                                                                                     |
| Performance NFR-02 (CPU < 2 % over 30 min)                             | **Maintainer: field**                               | `cpu-fallback.md` (#150) bounds the fallback cost by assumption; no field CPU session yet                                                                                                                                                                                                                                                             |
| Assisted typing (Revision 4: none in the agent)                        | **Met**                                             | #155 removed typing from the agent; `assisted-typing` 14/14; the site's copy button stays                                                                                                                                                                                                                                                             |
| Privacy and token (NFR-04, NFR-06)                                     | **Met**                                             | #94; consent notice and switch #156; every allowed telemetry attribute has a fixed shape and anything else is dropped (#186, #189, #194, security-reviewed). NFR-06 route count is a decision to confirm                                                                                                                                              |
| Remote configuration                                                   | **Met in code; Maintainer: field check**            | #112, #128, #139, #160; `remote-config` 27/28, T20 is the field check on an installer                                                                                                                                                                                                                                                                 |
| Agent lifecycle in window and site                                     | **Met**                                             | #83, #144; `@FR-05`/`@FR-16` scenarios green in run 45136543045                                                                                                                                                                                                                                                                                       |
| Delivery platform (ADR 033)                                            | **Maintainer: staging secrets, production**         | #113, #136, #157. Staging deploy fails at "Migrate the database" (run 45051442469): the `staging` environment has no Neon staging connection secret and no `RENDER_DEPLOY_HOOK`. Production service, Neon, Battle.net client and `production` secrets are the maintainer's. T11b-2 (agent promotion) waits on a decision (proposed: F3 with SignPath) |
| Load (Revision 4: 100 players, 0 errors, bytes ≤ ratchet ceiling)      | **Met**                                             | Run 45136543045 `load`: steps 25 to 400 passed, 0 errors at every step, p95 3.6–4.4 ms; **416,567** bytes per player-hour against the ceiling **447,000**. NFR-14's 125,000 target moved to F3                                                                                                                                                        |
| Releases (agent 0.4.0 through the draft flow, `--self-check --online`) | **Maintainer: after the phase merge; SignPath**     | #111. `agent-release` 7/12: T8 is 0.4.0 (release PR #103) after the phase PR merges; T9–T12 wait on SignPath roles and email                                                                                                                                                                                                                          |
| Upkeep (Dependabot PRs, #77/#80/#81 items)                             | **Met**                                             | #98, decisions "Upkeep" table; `upkeep` 15/15. Advisories closed by lockfile bumps, never an ignore entry: `url` 2.5.9 (RUSTSEC-2026-0592, #153) and `cookie` 0.18.3 (RUSTSEC-2026-0594, #197 on `phase/F2`, #198 on `main`)                                                                                                                          |

## Features

`node scripts/phase-status.mjs` @ `6f758ec8`: `next = run`; the only runnable step is `observability-tiers` T12. Counts
are the script's (it skips boxes marked **Waiting**).

| Feature              | Tasks | Main PRs                                                  | Open                                      |
| -------------------- | ----- | --------------------------------------------------------- | ----------------------------------------- |
| nightly-report       | 7/7   | #85, #89, #158, #165, #172, #187, #190, #191, #193        | —                                         |
| delivery-platform    | 12/13 | #84, #113, #136, #157, #185                               | T11b-2 (decision)                         |
| ocr-protection       | 9/9   | #89                                                       | —                                         |
| agent-room-lifecycle | 12/12 | #83, #144                                                 | —                                         |
| screen-recognition   | 16/19 | #93, #104, #120, #132, #142, #146, #149, #150, #154, #180 | 3 field                                   |
| server-name-match    | 12/12 | #101, #127                                                | —                                         |
| game-name-reading    | 14/17 | #107, #126, #130, #133                                    | 3 field                                   |
| capture-cascade      | 13/17 | #109, #117, #192                                          | 4 field                                   |
| assisted-typing      | 14/14 | #108, #155                                                | —                                         |
| agent-trust          | 10/10 | #94, #183, #186, #189, #194                               | —                                         |
| remote-config        | 27/28 | #112, #128, #134, #139, #160                              | T20 field                                 |
| stream-egress        | 9/9   | #99, #110, #122                                           | —                                         |
| upkeep               | 15/15 | #98, #153, #197                                           | —                                         |
| agent-release        | 7/12  | #111                                                      | T8 after the phase merge; T9–T12 SignPath |
| observability-tiers  | 12/13 | #143, #148, #156, #159, #166                              | T12 (staging traces)                      |
| staging-bots         | 12/12 | #123                                                      | runs once staging deploys                 |

Merged into `phase/F2`: **103** PRs (`gh api 'repos/pedromoraisf/d2rmatchmaking/pulls?state=closed&base=phase/F2' --paginate`,
`merged_at` set). Open into `phase/F2` besides this draft: #201 (the ADR 038 baseline proposal, docs only).

## Decisions to confirm

`decisions.md → To confirm` has 70 rows. The ones that change a stated requirement, a repository setting or a sensor:

- **NFR-06 names 3 agent routes; the code has 9.** The PRD wording is the maintainer's to change.
- **Phase pushes deploy staging with repository-level secrets** (#157). A ruleset for `phase/**` or a deployment-branch
  policy on the `staging` environment is a repository setting. Migrations stay expand-only meanwhile.
- **Keep-awake window 16:00–02:00 São Paulo instead of 24/7**; **promotion to production without a reviewer**.
- **Load ceiling 447,000 bytes per player-hour** against NFR-14's 70,000; the 125,000 target moved to F3. AD-128: the
  API alone sends 81,000 telemetry bytes per player-hour (share 1.086, not met); T12 adds the agent and the site.
- **Agent mutation**: exclusions in `.cargo/mutants.toml` are keyed by regex with `Evidence:` lines (#172). The
  agent-domain nightly runs in 5 round-robin shards (#187). The mutants build profile optimises dependencies only (#193,
  after #190's workspace-wide `opt-level = 2` doubled core and adapters).
- **The sanitizer's redundant wrong-type arms were deleted, not excluded** (#194).
- **API mutation (ADR 038, accepted 2026-11-23, #200)**: test-support fakes left the Stryker scope; killable survivors were
  killed (the lock map and the ready-check deadline map were not equivalent: both now have a `pending()` probe and a
  test); 4 equivalent mutants carry `// Stryker disable next-line <Mutator>: equivalent — <reason>`, checked by
  `scripts/api/mutation-disables.mjs`. Nightly 45205616909: api-domain 100, api-application 100. **Baseline proposal
  waiting on the maintainer**: api-application value 78.67 → 100 now; floors and `break` to 95 after two more 100 nights.
  Follow-up: the nightly summary of disables that match no mutant (ADR 038 item 1, last part).
- **The acceptance reset 503** names its failing step and Postgres code since #185; it has not recurred since.
- **Other client sizes proven only on drawn fixtures**; ultrawide and 4:3 move to F3.

## Blocked and deferred

- **Blocked** (`decisions.md → Blocked`): none open. Both rows are resolved (#104 wrong ceiling 45; #116 sharded
  `ocr-variations`).
- **Waiting on the maintainer**:
  - staging secrets (Neon staging connection, `RENDER_DEPLOY_HOOK`), which unblock T11, T12 and the staging bots;
  - the field test on the game PC (read rate, matrix, CPU, pt-BR selection screen, remote-config T20, 1440p and
    1600×900 prints kept outside the repository);
  - production (Render service, Neon, Battle.net client, `production` secrets, the variable `API_STAGES_LIVE` set to `true`);
  - SignPath roles and email; the T11b-2 decision.
- **Deferred to F3**: the 95 % synthetic-variation share, the 125,000 bytes target, ultrawide and 4:3, agent promotion
  with SignPath (proposed), and the Game Creator filling (out of scope, ADR 010).

## Quality

| Metric                                          | Baseline (`.quality-baseline.json`)       | Now                                                                                      | Source                     |
| ----------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| mutation api domain (%)                         | 100 → ratchet                             | **100.00**                                                                               | nightly 45205616909        |
| mutation api application (%)                    | 78.67 → ratchet                           | **100.00** (ADR 038, #200; was 91.72)                                                    | nightly 45205616909        |
| mutation agent core (%)                         | 100                                       | **100** (183 caught, 0 missed, 20 min)                                                   | nightly 45136543045        |
| mutation agent domain                           | not a ratchet metric                      | **0 missed, 0 timeouts** (5 shards, 194–211 caught each, 22–34 min)                      | nightly 45136543045        |
| mutation agent adapters                         | not a ratchet metric                      | **0 missed** (85 + 95 caught, 16 and 19 min)                                             | nightly 45136543045        |
| CI duration (s)                                 | 588 (ceiling 900)                         | `ci` push run 45169930254 @ `6f758ec8`: success, 925 s wall (includes the agent OCR job) | Actions run                |
| load: max players / bytes per player-hour / p95 | 400 / 405,334 (ceiling 447,000) / 27.7 ms | **400 / 416,567 / 3.6–4.4 ms**, 0 errors                                                 | nightly 45136543045 `load` |
| ocr.variations correct / wrong                  | 5727 floor / 45 ceiling                   | held on every reading-module PR of this phase                                            | `ocr-variations` per PR    |
| acceptance failed / flaky                       | 0 / 0                                     | **358 passed**, 0 failed                                                                 | nightly 45136543045        |

## Lessons added

Nine commits on `phase/F2` change `docs/engineering/lessons.md` (`git log origin/main..phase/F2 -- docs/engineering/lessons.md`).
The newest: measure a mutation build-profile change on the runner for every mutated crate (#190 → #193); a wrong-type
`return false` arm before a deny-by-default tail is a surviving mutant (#194); a test recording `tracing` spans needs a
process-wide subscriber (#158).

## After the draft (2026-11-23 to 2026-11-24)

Merged after the numbers above were taken, so the PR count above is from the draft:

- #202 (main) and #203: the nightly backup uploads to R2 with region `auto`; proven by main nightly 45453145359, all green.
- #204 and #205: staging's own site origin, and staging deploys run in the GitHub environment `staging`
  (incident `docs/engineering/incidents/2026-11-23-staging-environment.md`); staging answers `b6710f23` since run 45322379379.
- #206: observability-tiers T11, the TraceQL result on staging (5 traces for a staging-bots room).
- #207: the maintainer's field validation (two live journeys confirmed by the agent; the rest of the field runbook waived
  until after launch, risk accepted).
- #208: the `staging-bots` skill.

## Approval

**Approved**: 2026-11-24 - user: "O documento da PR eu aprovo"
