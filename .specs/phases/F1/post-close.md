# Phase F1 — after the review was approved

The F1 review was approved on 2026-11-12. The maintainer concluded the phase on 2026-11-20: "registre todo o status do
projeto, marque a fase 1 como concluida". This file records what happened between those dates and what is still open.
It is the backlog to read when replanning F2 and later. Numbers and links come from the PRs named below.

## Incidents and fixes (2026-11-13 → 2026-11-20)

The agent's Party-panel presence did not work in production. Generated room names (`mm…-NN`) in D2R's small-caps font
were never proven on a real print: the only real Party print was "DUEL NK LOCKS". OCR read the `B` as `8`.

Fixes, merged to `main`:

- #73: test installer API base.
- #74: `--self-check` before any upload or release.
- #75: capture and Party diagnostics; `GetWindowRect` allowed.
- #76: generated names on real prints; `8` read as `b` before the dash; drift test in the harness; collision test 1..9999.
- #77: rooms named for normal (`n`) and nightmare (`m`); the refusal is logged, not dropped.
- #79: release-please drafts the release; the API is woken before `--self-check --online`.
- #80: the site shows a closed or expired room as ended, with Dismiss; the locked label sits under the difficulty name.
- #81: acceptance port race; the RDY-07 wait for the site stream.

Agent 0.3.0 was released on 2026-11-19. The maintainer confirmed presence end to end (room `Created`, "Confirmed by the
agent").

The first real release surfaced two problems:

- release-please published the release immediately and marked it Latest with no assets;
- Render's free tier sleeps, and `--self-check --online` failed until the API woke.

The bot release PR needed "Approve and run" on its workflows. The OCR zip was re-encrypted with a new password, and the
maintainer updated the `OCR_PRINTS_PASSWORD` secret (2026-11-19).

## Maintainer decisions taken in chat

Also recorded in [`decisions.md`](decisions.md).

1. 2026-11-19, "1. Liberar a GetWindowRect": add `GetWindowRect` to the unsafe-adapter allow-list
   (`scripts/test/agent-source-rules.test.mjs`).
2. 2026-11-19, "Corrija agora as salas de normal e nightmare", then "Sim": approved changing three existing lobby-room
   tests that encoded "F0 plays hell only" (commit 36d3cc5) and one new acceptance scenario for nightmare (tagged
   `@LBR-01`).
3. 2026-11-19, "2. PR logo depois desses": the agent reading rewrite comes as its own PRs after #75/#76, not as an F2
   feature.
4. 2026-11-19: the release PR #70 was approved by the maintainer on GitHub, and its workflow runs approved by them (no
   chat sentence; the maintainer did not say "Faça o merge").
5. 2026-11-20: F1 concluded ("registre todo o status do projeto, marque a fase 1 como concluida").

## Deferred and open items

Each item names its origin and status.

### Agent reading (rewrite, in progress or not started)

- (a) In-game marker by searching "Life"/"Mana" in a wide bottom band with search-then-track. It fixes "Screen: not
  recognised" and the site's "Screen: Unknown". Origin: field test of 0.3.0. Status: work in progress exists locally,
  not pushed: branch `feat/agent-ingame-band-search`, commit 4e190ad, plus an uncommitted change to
  `core/src/screen_reader.rs`, in worktree `.claude/worktrees/agent-a18a199d6469064c9`. The worker was interrupted.
- (b) The agent drops its assignment on `room.stage_changed` expired or closed. Today `adapters/src/http/sse.rs`
  ignores it, so the window keeps "waiting for the game". Status: not started; the worker was interrupted with no
  commits.
- (c) The agent window shows "presence confirmed" after a successful match. Today it keeps "waiting for the game", and
  the maintainer read that as a broken presence. Status: not started.
- (d) The automap as a second game-name source. The maintainer suggested reading the name from the top of the screen.
  Status: idea.
- (e) The 398/500 refusals on the `mmbaalh-19` print variations, mostly `label-not-found-layout-other`. Status: open.
- (f) 176 popups with no card read and 104 unrecognised selection screens. They predate this record; see the PR #71
  numbers. Status: open.
- (g) The 43 wrong reads, all the "O" of a character name read as g/e/b. The real fix is server-side matching against
  the account's characters, which changes the agent-API contract. Origin: ratchet of 2026-11-18. Status: the
  maintainer's decision pending (F2?).
- (h) Robustness field tests on 0.3.0 not done: window mode, legacy graphics (G), low and high brightness.
- (i) Normal and nightmare rooms not tested live: the test match always creates hell (#77).
- (j) Telemetry: adding `panel_open` and the field state to the Party span needs a change to existing span tests (the
  maintainer's decision; not asked yet).
- (k) The recommended set of 7 real Party prints covering every glyph (`apps/agent/ocr-lab/README.md`): only
  `mmbaalh-19` is in the zip.

### Release and signing

- SignPath Foundation: the maintainer applies. Needed: a "Code signing policy" page on the site and in the README, MFA,
  roles. The maintainer has not confirmed roles or the contact email yet.
- Publish only after the `sign` job when signing is enabled (security review of #79).
- Proofs only possible on the next real release: draft plus `force-tag-creation`, `release_created` for a draft,
  tauri-action attaching to the draft, the 90 s wake.
- The unsigned public release stays until SignPath.

### Production

- The Render free API sleeps after about 15 min. The first visitor gets a 502 through the proxy. Already deferred in
  `handoff.md` ("the site should retry while the free Render API wakes up").
- Proposed: a 10-minute Actions ping to `/healthz` plus a site/proxy retry with a "waking the server" message. Awaiting
  the maintainer's decision.

### Site

- "Dismiss" is lost on reload (#80 review).
- The CSS-reading test in `QueuePanel.test.tsx` is brittle; replace it with a Playwright bounding-box check (#80
  review).
- The site's stream reconnect was not investigated, in case "agent online · game open" lingers well over a minute (#80
  worker).

### API

- The n/m/h codes are not listed in ADR 017 (#77 review).
- The `app.ts` match-refused log branch has no direct test.
- A per-account limit on the ready-check answer routes (F1 review; security review of #52, low).
- The ClockScheduler next-due short-circuit (F1 review; architecture review of #52).
- The load harness "rooms open at the step end" reads 0 (F1 review).

### CI and harness

- 11 open Dependabot PRs (#13–#18, #36, #38, #39, #42, #78), several majors: upload-artifact 7, download-artifact 8,
  tauri-action 1.0, release-please-action 5, github-script 9, Playwright 1.65.
- Minor items from #81: unclear error when `accountId` is missing in `openSiteFor`; the traced-stack retry rebuilds the
  telemetry site.
- The drift test hard-codes `pvp`.
- The Node 20 deprecation warning on release-please-action.

### Carried from `handoff.md`

Status as read from the files; confirm before acting.

- Preview redirect URL at Blizzard: one fixed Pages alias for every phase preview (update `preview.mjs`,
  `preview-api.yml`, `deploy-web.yml`, tests and ADR 030; the maintainer then registers the URL). Not recorded as done.
- `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` as `sync: false` names in `render.yaml`. Not recorded as done.
- The branch `feat/F0-parallel-cloud-spike`: an F0 spike, remote at `87be3b5`, not merged, not part of F1. Open.
- Signing the agent and the `ocr-check` tool (Windows App Control blocked the unsigned tool): see SignPath above.
- The site retry while the free Render API wakes up: see Production above.
- A per-account limit on the ready-check routes and the ClockScheduler short-circuit: see API above.
- Dependabot PRs: see CI and harness above.
- The agent's per-branch pipeline (preview channels), the first F2 work named in the review approval. Not started as far
  as the files show.
- `feat/F1-characters-reading` (#50) and `fix/F1-room-view-500` from `handoff.md` are merged into `phase/F1` per the
  review.

### Load runs

Load runs are local only (`pnpm test:load`, `docs/engineering/testing.md`), never in CI. Recorded runs:

| Date       | Commit    | Result                                                                                                           |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| 2026-11-04 | `07da672` | Baseline: 400 players, 0 errors, p95 1.38 ms at 100, 113,827 bytes/player-hour                                   |
| 2026-11-07 | `35de8ab` | F0 review: 400 players, 0 errors, p95 1.23 ms, 113,836 bytes/player-hour                                         |
| 2026-11-12 | `28cbc13` | F1 review: 400 players, 0 errors, p95 27.7 ms at 100 and 132.9 ms at 400, bytes over the ceiling                 |
| 2026-11-12 | `b7faafb` | Last: 400 players, 0 errors, p95 5.5 ms at 100, 421,369 bytes/player-hour against a 70,000 budget, rooms count 0 |

Open items:

- The egress regression: about 6x the budget in F1, against about 1.6x in F0.
- The room count reads 0 (`full-summary.check.mjs` fails 1 of 9).
- No run since 2026-11-12, so #77 and #80 are unmeasured.

### Nightly (maintainer's priority for the F2+ planning)

**State.** `nightly.yml` (cron 03:17 São Paulo, also `workflow_dispatch`) has failed every night since 2026-11-13 (runs 43444737059 … 44558970584). Only 2026-11-10 and 2026-11-12 passed in the last ten. On 2026-11-19:

- `agent-mutation` failed in all three crates.
  - core: the unmutated baseline fails. `party::look_tests::the_span_of_a_closed_panel_says_neither` fails under `cargo test` (cargo-mutants runs the lib tests in one process), while it passes under `cargo nextest` in CI. This suggests tests sharing global telemetry state across threads: a test-isolation bug, not a mutant.
  - domain: many MISSED mutants in the OCR reading code written during the F1 incidents: `anchors.rs` (`find_cards_in_variants`, `is_popup_title`), `character_screen.rs` (`is_gold`, `label_brightness`, `read_screen`, `popup_difficulties`, `read_level`), `characters.rs` (`is_character_name`), `layout.rs` (`PanelBox::resolve`).
  - adapters: failed too (cause not yet read).
- `quality` failed on the nightly quality ratchet.

**What the maintainer wants (2026-11-20, in chat).** Quote: "quero dedicar atenção ao nightly… nesse nightly que deveria rodar os testes de carga e outros de alto nível que gerem um relatorio a cada execução de: relatorio util sobre mutação, resumido; como esta a carga do jogo; se as aceitações (bdd) estão passando e tudo mais (listar elas também)… não quero que o agente trabalhe e espere a noite para testa-lo… quero que desenvolva e dispare ele em sequencia para ir testando os pontos (com a maior celeridade possivel)".

1. Each run produces one readable report with three parts: a short, useful mutation summary per crate and module (score, survivors grouped by file, trend); the load results (players, errors, p95 per step, bytes per player-hour against the budget, rooms); and the acceptance results, listing every scenario with pass/fail and tags.
2. The nightly runs the high-level suites, including the load run. Today load is local-only by design (testing.md: "never part of `pnpm check` or a pull-request workflow"; AD-110), so moving it to a GitHub runner needs a decision (Docker limits on the runner, duration, cost of minutes on a public repo), and possibly an ADR amendment.
3. While developing, the agent dispatches the nightly (`gh workflow run nightly.yml --ref <branch>`) and iterates on it immediately, not waiting for the cron. This is compatible with ADR 026/029: mutation never runs on a PR or in a task gate, but an on-demand dispatch is allowed. Speed matters: shard jobs and run only what changed where possible.

**Mutation and OCR (the orchestrator's answer to the maintainer, 2026-11-20).** Mutation testing measures whether the unit tests catch changes to the code's logic (thresholds, comparisons, glyph tables). It does not train or improve the OCR's reading of the game. The survivors in `anchors.rs` and `character_screen.rs` show that the reading logic changed in F1 is weakly tested, which is a regression risk for OCR work. Reading quality is measured by the `ocr-variations` job (correct, refused or wrong over thousands of variations of real prints) and improved with real prints and search-based reading.

## How to resume

Start with `pnpm phase:status`, `gh pr list`, then this file. Remove stale worktrees once their work is pushed
(`git worktree list`).
