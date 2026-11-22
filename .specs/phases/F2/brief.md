# Phase F2 — Agent with presence

**Goal**: The agent reads the game reliably on any player's PC, and the project can prove it every night. F2 covers the
roadmap's scope: capture cascade, OCR reading of the Party panel and the chat, fusion, remote configuration and
assisted typing, with a read rate of at least 95% under NFR-02/03. It also takes the whole F1 post-close backlog
(`.specs/phases/F1/post-close.md`), a nightly that reports mutation, load and acceptance in one report, and the F2
work that F1 deferred: one delivery platform for the three apps, with the same environments and pipeline stages for
each (it brings the agent channels per branch and the staging and production split), and cutting stream bytes.
**Roadmap**: .specs/phases/ROADMAP.md#f2
**Status**: APPROVED — 2026-11-20

## How F2 runs

The lean flow of ADR 029 (`.claude/skills/d2rmm-phase-runner/SKILL.md`): per feature a spec with its Gherkin
scenarios, a design only when Large or Complex, a task checklist, and one PR into `phase/F2` merged when CI is green.
Mutation runs in the nightly. The maintainer approves this brief and the review. Between the two, only the escalations
of AGENTS.md and the inputs below reach them.

What is new in F2 is where the work runs. The maintainer decided this on 2026-11-20 (see "Decisions already taken"):

- **Orchestrator**: the session running on the maintainer's MacBook, which is on 24/7. It writes the specs and tasks,
  starts the workers, follows each PR through its GitHub events, dispatches the reviewers, merges, and keeps
  `decisions.md` up to date. Passwords, secrets and real prints stay on that machine.
- **Workers in the cloud**: each feature batch runs in its own Claude Code cloud session, on Sonnet (ADR 031), on the
  branch `feat/F2-<feature>`. A cloud session is its own clone of the repository, which plays the role ADR 025 gives
  the worktree. The `feature-worker` instructions apply unchanged. **At most 3 workers at a time**: there are no extra
  usage credits, and every session shares the plan's quota.
- **Local lane (the Mac)**: OCR tuning against the real prints, which never leave the machine (AGENTS.md "Never do").
  It also covers load runs until the nightly carries them, and anything that needs the maintainer's credentials.
- **The maintainer's game PC**: field tests, new real prints, and the CPU and FPS check.
- **CI is the proof for what a Linux cloud session cannot run**: the Windows app crate (`agent`, `agent-build`) and
  the real-print proofs (`ocr-real` with the encrypted prints).

The "Runs" column of the features table says where each feature's work happens. The cloud pilot of 2026-11-20 ran
lint, typecheck, the unit, harness, Rust (455 tests), integration (186, with Docker) and acceptance (237) suites in a
cloud session. They need Node 26, a full clone, `cargo-nextest`, a Playwright browser link and `dockerd` started, all
of which go into the environment's setup script; the maintainer approves that script.

Two limits shape the flow:

- `git push` from the cloud needs the Claude GitHub App on the repository.
- `gh` GraphQL calls such as `pr create` are blocked in the cloud. Cloud workers only push their branch. The
  orchestrator on the Mac opens, reviews and merges the PRs, as the skill already says.

The findings are documented in `docs/engineering/cloud-sessions.md`.

## Exit criteria

Every item needs a proof in the phase review.

- [ ] **Nightly green and readable.** The nightly passes three nights in a row. Each run publishes one report with
      three parts. Mutation: score per crate and module, survivors grouped by file, and the trend against the previous
      run. Load: players, errors, p95 per step, bytes per player-hour against the budget, and rooms. Acceptance: every
      scenario with its tags and result. Any session can dispatch it on a branch with `gh workflow run`, and it shards
      so the full run takes **40 minutes or less** of wall time. Proof: the three run links and their reports.
- [ ] **The OCR reading logic is protected.** The rule is written into AGENTS.md and the `feature-worker`
      instructions. In the reading modules, every survivor is either killed by a test that pins the current behaviour
      or excluded with its real-print evidence. Nothing is left unexplained. Proof: the nightly report and a harness
      test on the exclusions file.
- [ ] **Read rate of 95% or more (FR-27, roadmap exit).**
  - The game name is read correctly in at least 95% of the `ocr-variations` of real Party prints covering every
    glyph the server generates (7 prints).
  - It is never read as another room's name (zero wrong confirmations).
  - In real sessions, at least 95% of the rooms in the maintainer's field log reach "Confirmed by the agent". The log
    has at least 20 rooms across normal, nightmare and hell.
  - Proof: the `ocr-variations` ratchet and the field log.
- [ ] **Character and screen reading**: popups and selection screens are recognised in at least 95% of their
      variations. The 43 wrong reads of "O" are gone, through server-side matching against the account's characters.
      The in-game screen is recognised in windowed and full-screen modes (items a, f, g). Proof: the variation
      ratchet, unit tests, `@FR-05` and `@FR-02` scenarios.
- [ ] **Chat**: the agent reads the "joined" and "left" messages for members of its room (FR-27). Proof: unit tests on
      drawn fixtures, the real-print proof, and the field log.
- [ ] **Robustness (NFR-03)**: the agent works in full screen, borderless and windowed modes, with legacy graphics, at
      low and high brightness, and with no game configuration. Exclusive full screen is handled by the capture
      cascade. Proof: the maintainer's field matrix and fixtures for each mode.
- [ ] **Performance (NFR-02)**: average CPU below 2% over a field session of 30 minutes or more, and no FPS drop the
      maintainer can notice. Proof: the agent's CPU telemetry and the maintainer's check.
- [ ] **Assisted typing (FR-28)**: a hotkey types the game name into the Game Creator only while D2R has focus, and
      never presses Enter. Proof: unit tests, the source-rule test that no confirm key is sent, the security review
      and the maintainer's check.
- [ ] **Privacy and token (NFR-04, NFR-06)**:
  - The agent captures only the game window and sends only structured observations. A print leaves the PC only when
    the player acts.
  - The agent token is revocable and works only for heartbeat, observations and push. The agent accepts data and
    never commands.
  - Proof: `@NFR-04` and `@NFR-06` scenarios, source-rule tests and the security review.
- [ ] **Remote configuration**: reading regions, chat texts per language, thresholds and frequencies come from a
      versioned JSON served by the API. Changing a region needs no new agent version. Proof: a scenario and a unit
      test on the version fallback.
- [ ] **Agent lifecycle in the window and on the site**: the agent drops a room that expired or closed, the window
      shows "presence confirmed", and the site keeps a dismissed room dismissed after a reload (items b and c, #80
      review). Proof: scenarios.
- [ ] **Delivery platform (ADR 033).**
  - The site, the API and the agent share the same environments: preview per PR, staging from `main`, and production
    by promoting the same build.
  - They also share the same stages: build once, verify, deploy, smoke check (`/healthz`, the page, `--self-check`),
    promote. The stages are reusable workflows with one thin caller per app.
  - Staging and production are separate: API services, databases and Battle.net credentials, at no cost beyond the
    free tiers unless the maintainer approves otherwise (NFR-07).
  - Every agent PR builds an installer for its preview API. It installs side by side with the released agent, with
    the updater off.
  - The old deploy, preview and release workflows are removed after the new ones pass on real runs.
  - Proof: the run links for each app and environment, the two health endpoints, and an agent PR artifact with its
    `--self-check`.
- [ ] **Load**: 100 or more players with 0 errors on the real journey (NFR-14), run by the nightly. Bytes per
      player-hour drop from 421,400 to 125,000 or less (F0 had about 113,800 at its ceiling of 125,000). The room count
      measures again. Proof: the nightly report.
- [ ] **Releases**: agent 0.4.0, and every later release, published through the draft flow with assets and checked by
      `--self-check --online`. The code signing policy page is ready for SignPath. Proof: the release links.
- [ ] **Upkeep**: every Dependabot PR open at kickoff is merged or closed with its reason, and the review items of #77,
      #80 and #81 are done. Proof: the PR list.

## Features

| Feature              | Size   | Depends on                               | Parallel               | Runs                | Covers                           |
| -------------------- | ------ | ---------------------------------------- | ---------------------- | ------------------- | -------------------------------- |
| nightly-report       | Large  | —                                        | yes (wave 1)           | cloud               | NFR-14 (nightly), ADR 026        |
| delivery-platform    | Large  | —                                        | yes (wave 1, serial)   | cloud + local + CI  | NFR-07, NFR-08, FR-29, ADR 032   |
| ocr-protection       | Medium | —                                        | yes (wave 1)           | cloud + CI          | NFR-02 (guard), ADR 026          |
| agent-room-lifecycle | Medium | —                                        | yes                    | cloud + you         | FR-05, FR-16 (hardening)         |
| screen-recognition   | Large  | ocr-protection                           | yes                    | cloud + local + you | FR-05, FR-02 (hardening), NFR-03 |
| server-name-match    | Large  | ocr-protection                           | yes                    | cloud               | FR-16, FR-27, FR-02 (fusion)     |
| game-name-reading    | Large  | ocr-protection                           | yes                    | local + cloud + you | FR-27                            |
| capture-cascade      | Large  | screen-recognition                       | with game-name-reading | cloud + CI + you    | NFR-02, NFR-03, NFR-04           |
| assisted-typing      | Medium | delivery-platform                        | yes                    | cloud + CI + you    | FR-28                            |
| agent-trust          | Medium | agent-room-lifecycle                     | yes                    | cloud               | NFR-04, NFR-06                   |
| remote-config        | Large  | capture-cascade, game-name-reading       | no                     | cloud               | FR-27, NFR-03 (configuration)    |
| stream-egress        | Medium | nightly-report                           | yes                    | cloud               | NFR-14 (egress)                  |
| upkeep               | Medium | —                                        | yes (fills free slots) | cloud               | CI, review items of #77/#80/#81  |
| agent-release        | Medium | agent-room-lifecycle, screen-recognition | no                     | cloud + CI          | FR-29, ADR 015, ADR 016          |

Notes:

- **Waves.** Wave 1 is `nightly-report`, `delivery-platform` and `ocr-protection`. `agent-room-lifecycle` and `upkeep` take
  the next free slots. When the protection rule is in force, `screen-recognition`, `server-name-match` and
  `game-name-reading` follow, and `game-name-reading` starts in the local lane. Never more than 3 cloud workers at once.
- **Work already started** resumes from its branch. `fix/agent-drop-expired-room` (item b) feeds `agent-room-lifecycle`
  and `feat/agent-ingame-band-search` (item a) feeds `screen-recognition`. Both were pushed on 2026-11-20.
- **Mapping the post-close items (`F1/post-close.md`)**:
  - Agent reading: a and f → `screen-recognition`; b and c → `agent-room-lifecycle`; d, e, i and k →
    `game-name-reading`; g → `server-name-match`; h → `capture-cascade`; j → `agent-trust`.
  - Production keep-awake, the preview redirect alias at Blizzard and the `BNET_*` names in `render.yaml` →
    `delivery-platform`.
  - Site and API items, Dependabot and CI → `upkeep`.
  - The egress regression and the room count → `stream-egress`.
  - SignPath and publish-after-sign → `agent-release`.
- **Reading logic**: every PR that changes a threshold, a box, a glyph table or an anchor carries the real-print proof:
  `ocr-real` green and `ocr-variations` not regressing on its ratchet.
- **Security review** on the diff for `delivery-platform`, `assisted-typing`, `agent-trust`, `capture-cascade`,
  `server-name-match` and `agent-release`.
- **New ADRs** are written as Proposed inside their feature, and the maintainer accepts them:
  - 033, the delivery platform: environments, stages and agent channels for the three apps (it extends the agent
    channels planned at F1);
  - 034, workers in cloud sessions, which notes ADR 025's worktree;
  - 035, the load run in the nightly, which changes `testing.md` rule 8.
- **How `delivery-platform` runs.**
  - **Design first**: ADR 033 and `design.md`, with the target map of environments and stages for the site, the API
    and the agent.
  - **One worker, in series**: it is the only feature that touches the deploy, preview and release workflows. Its PRs
    go **straight to `main`**, because those workflows only fire for real from `main`. After each merge,
    `phase/F2` merges `main` in.
  - **Strangler, never a big bang**: each new workflow runs beside the old one, and the old one is removed only after
    the new one passes on real runs.
  - **Order, lowest risk first**: the site, then the API with the staging and production split (the maintainer sets
    the new secrets; the local lane does what needs them), then the agent channels.
  - **Frozen**: `ci.yml` (the PR checks and their required names), `nightly.yml` (owned by `nightly-report`) and
    `ocr-real.yml`.
  - Only `assisted-typing` and `agent-release` wait for it. Field tests use the per-PR test installer that already
    exists.

## Decisions already taken

- **F2 takes this whole execution**: the F1 post-close backlog, all the reading items a to k, and the nightly
  (maintainer, 2026-11-20: "O item 3 pega apenas alguns pontos. A ideia era pegar todos. Nessa leva, a F2 será a
  incorporação dessa execução. Isso é um replanejamento"). This supersedes the F1 decision that the reading rewrite
  comes as loose PRs (F1 `decisions.md`, 2026-11-19).
- **Order and quality** (maintainer, 2026-11-20: "Aprovo a ordem, porém quero qualidade no desenvolvimento"): nightly
  and report first, then OCR protection, then the reading items, then Dependabot.
- **Nightly goals** (maintainer, 2026-11-20, quoted in `F1/post-close.md`): one report per run with mutation, load and
  acceptance. The load run moves into the nightly. Agents dispatch it while they work instead of waiting for the night.
- **Parallel agents in the cloud** (maintainer, 2026-11-20: "Quero que vários agentes toquem esse projeto em paralelo e
  não só na minha máquina"), **with no extra usage credits** ("Não vou ligar créditos extras").
- **The orchestrator runs on the MacBook** (maintainer, 2026-11-20: "O orquestrador será na minha máquina para não ter
  que lidar com problemas de senha ou segredos que eu tenha que controlar pela máquina do MacBook. Essa máquina está
  carregando e fica ligada 24/7").
- **Agent channels per branch are the first work of F2** (maintainer, 2026-11-12: "essa pipeline do agent é
  desenvolvida nos primeiros momentos da fase 2").
- **The staging and production split moves to F2** (maintainer, 2026-11-12: "vamos adiar esse trabalho para a fase 2").
- **One delivery platform, with its PRs straight to `main`** (maintainer, 2026-11-20: "Aceito as duas
  recomendações").
  - The two recommendations were: merge the agent channels and the staging and production split into one feature,
    `delivery-platform`, whose ADR 033 covers the three apps.
  - And: its PRs go straight to `main`, with `phase/F2` merging `main` in after each one. This is an explicit
    exception to ADR 028's "into `main` through the phase PR", limited to this feature.
  - It also covers the uniform staging environment and pipelines the maintainer asked for.
- **Cutting stream bytes is an F2 task** (maintainer, 2026-11-12, with the load cost accepted: "Aceito").
- **Workers on Sonnet** (ADR 031); reviewers on Sonnet.

## What I need from you

1. **The OCR protection rule.** Do you approve its four points (`F1/post-close.md`)?
   - A survivor is killed only by a test that pins the current behaviour.
   - Changing the reading logic needs the real-print proof.
   - Equivalent mutants are excluded with their evidence.
   - The rule goes into AGENTS.md and the worker instructions.

   Options: approve / change. Recommendation: approve. It is your "sacred logic" safeguard, and AGENTS.md is yours to
   change (rule 4).

2. **The read-rate definition**: at least 95% correct with **zero** wrong confirmations, against at least 95% correct
   alone. Recommendation: zero wrong. A wrong read confirms the wrong room, which is worse than a refusal.
3. **Load in the nightly, on a GitHub runner** limited like Render (`--cpus 1`, `--memory 512m`). Minutes are free for
   a public repository. Options: nightly (ADR 035) / keep local. Recommendation: nightly, as you asked. It changes
   `testing.md` rule 8.
4. **Keeping the API awake.** Render's free tier gives 750 instance-hours a month per workspace, which I will confirm
   before applying. One service awake all the time fits; staging and production both awake do not. Options:
   - (a) a 10-minute ping on production only, staging sleeps, and the site retries with a "waking the server" message;
   - (b) site retry only;
   - (c) a paid plan.

   Recommendation: (a).

5. **Server-side matching (item g)** changes the agent–API contract: the agent sends what it read, and the API matches
   it against the account's characters. Options: in F2 / later. Recommendation: in F2, because it removes the 43
   wrong reads at the root.
6. **Telemetry on the Party span (item j)**: add `panel_open` and the field state, which changes existing span tests by
   adding assertions, not loosening them. Options: yes / no. Recommendation: yes.
7. **ADR 017 amendment**: list the `n`/`m`/`h` difficulty codes the code already uses (#77). Options: yes / no.
   Recommendation: yes. It documents existing behaviour.
8. **Inputs from your game PC.** Whatever is missing does not block the phase: the features that need it stop at
   their real-print step and the rest continue.
   - (a) The 7 Party prints listed in `apps/agent/ocr-lab/README.md`.
   - (b) Automap prints showing the game name.
   - (c) Chat prints with "joined" and "left" messages, in English and Portuguese.
   - (d) The field matrix on the 0.3.0 agent: windowed, borderless and full screen; legacy graphics; low and high
     brightness.
   - (e) Live rooms in normal and nightmare.
9. **SignPath**: the roles and the contact email. Then you apply.
10. **The cloud environment's setup script**: you approve it in a prompt once the pilot finishes.

## Out of scope

- Scores, disputes, ELO, ranking and live rooms (F3).
- Moderation, LGPD consent and retention (NFR-05), regions and the beta (F4). Signing itself waits for SignPath; F2
  only prepares for it.
- The macOS/Linux agent.
- The F0 spike branch `feat/F0-parallel-cloud-spike`, left untouched.

## Approval

**Approved**: 2026-11-20 - user: "aprovado o brief"

The maintainer approved the brief without changing "What I need from you". The message that presented the draft said
the recommendations would be followed for any item left unanswered. So items 1 to 7 take their recommendations:

1. The OCR protection rule, as written.
2. Zero wrong confirmations.
3. Load in the nightly (ADR 035).
4. Option (a) for keeping the API awake.
5. Server-side matching in F2.
6. The Party span attributes.
7. The ADR 017 amendment.

Items 8 to 10 remain inputs. They are tracked in `decisions.md → Waiting on the maintainer`.

## Revision 1 — assisted typing becomes a clipboard copy (2026-11-21)

**Why.** In the field test of 2026-11-21 the maintainer found that the fill hotkey (Ctrl+Shift+F) is more work than the
game's own behaviour: Ctrl+V already pastes into the Game Creator's name field (checked by the maintainer the same day).
Typing by synthetic keystrokes is also the riskiest thing the agent does with respect to Blizzard's terms, and the
maintainer does not want that risk.

**What changes.**

- FR-28 is met by a **copy, not by typing**: when the agent holds a room and knows its game name, it writes that name
  to the Windows clipboard once, when the room opens, and its window says "Nome da sala copiado — use Ctrl+V". It never
  sends a key to the game. The site's copy button stays as the fallback.
- **Removed**: the fill hotkey, `SendInput` and `GetAsyncKeyState` (AST-01 to AST-07 and AST-09). The sensor exception
  approved for AST-09 is withdrawn, so the agent's adapters go back to sending no input at all (AGENTS.md rule 5).
- The ready check's accept hotkey (RDY-07) is not affected.
- The exit criterion "Assisted typing (FR-28)" reads: _when a room opens, the agent copies its game name to the
  clipboard, never types into the game and never presses a key. Proof: unit tests, the source-rule test that the agent
  sends no input, the security review and the maintainer's check (Ctrl+V in the Game Creator)._
- `assisted-typing`'s spec, scenarios and tasks are rewritten for the copy (a new batch); its merged typing code is
  removed in the same PR.

**Out of scope, recorded for later.** Filling the Game Creator or clicking through the game's menus for the player:
it would send input that navigates the game, which ADR 010 forbids, and it carries the same terms-of-service risk.

**Approved**: 2026-11-21 - user: "sobre o ctrl v (remover a feature de ctrl shift f), aprovo"

## Revision 2 — observability in two tiers (2026-11-21)

**Why.** Field tests on 2026-11-21 could not be followed in Grafana: 10% API sampling, no agent or site spans, no ids.
**What changes.** ADR 037: on staging and test installers telemetry carries everything (ids, the player's names, OCR
text and corrections, game data); in production it carries ids and all non-personal game data, never a person's name or
text read from the screen. A new feature `observability-tiers` (agent, site and API spans by tier, with tests proving
production redaction) joins F2; its spec and tasks are written by the orchestrator before dispatch.

**Approved**: 2026-11-21 - user: "aprovo."

## Revision 3 — the read rate is measured on real rooms; synthetic variations become a ratchet (2026-11-22)

**Why.** The `ocr-variations` set multiplies each real print into hundreds of synthetic variants (blur, JPEG quality,
brightness, scale). Several of them are degradations a real capture never produces (strong blur, JPEG q30), and tuning the
reading modules to read them risks wrong reads on real frames, which the brief already ranks as worse than a refusal. The
real goal of FR-27 is that real rooms confirm.

**What changes.**

- The exit criterion "Read rate of 95% or more (FR-27, roadmap exit)" reads: _the game name is never read as another
  room's name (zero wrong confirmations, in `ocr-real` and in every `ocr-variations` run), and at least 95% of the rooms in
  the maintainer's field log reach "Confirmed by the agent" (at least 20 rooms across normal, nightmare and hell). Proof:
  the field log, `ocr-real` and the `ocr-variations` wrong ceiling._
- The `ocr-variations` correct count is a **ratchet**, not a target: every PR keeps it at or above the floor and the wrong
  count at or below the ceiling. The 95% share of synthetic variations (game name, popups, selection screens) moves to
  **F3** as a target.
- The criterion "Character and screen reading" keeps its scenarios and unit tests; its "95% of their variations" part
  moves to F3 with the rest of the synthetic share.
- The ratchet floor of `ocr.variations.correct` moves from 5665 to 5727 (the count after #133), approved the same day.

**Approved**: 2026-11-22 - user: "Opção 2" (the read-rate decision) and "Ok" (the ratchet floor 5727)
