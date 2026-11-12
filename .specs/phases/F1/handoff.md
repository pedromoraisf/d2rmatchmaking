# Phase F1 — handoff (2026-11-12)

The previous runner session stopped at the maintainer's request (new chat; the machine is being cleaned and reset).
`node scripts/phase-status.mjs F1` stays the source of what is merged; this note lists what is in flight on branches,
which phase-status does not see. Read `docs/engineering/lessons.md` and `.specs/phases/F1/decisions.md` first.

## Merged into `phase/F1`

All seven brief features are merged and `phase-status` reports `review`: identity-bnet (#43), characters (#44),
site-shell (#45), agent-game-name (#48), queues (#51), ready-check (#52), lobby-rooms (#54), journeys-e2e (#55).
Harness and CI: #46, #47, #49, the apt-free Chromium install (#53), API pull request previews (#56, ADR 030) and the
preview service match (#57).

## In flight

### `feat/F1-characters-reading` (PR #50) — exit criteria 4 and 8

- The maintainer's five real screenshots are committed as one AES-256 zip, `apps/agent/ocr-lab/real-prints.zip` (the
  one exception the maintainer allowed; password in the secret `OCR_PRINTS_PASSWORD`; the `ocr-lab` sensor refuses any
  unencrypted entry).
- The `ocr-real` job (Windows runner) reads them on every push to the PR and prints per-region diagnostics for four
  upscales (nearest/bilinear, 3x/4x).
- First real run (43136889694): the regions are right; the parser is too strict. Reads such as `OUEL NK LBCKS`
  (bilinear 3x reads `DUEL NK LOCKS`), `LEWEL 88 SBRCERESS`, `m ATRIARCH`, `VUKVUKA`, popup `NeRtTIAL` / `NIGHTmARE` /
  `HELL`. The masked Party panel already passes; 4 of 5 files fail.
- A worker was implementing Batch 5 (T19–T22: closed-vocabulary matching with a unique-nearest rule, a digit confusion
  map with range 1..99, several readings per region with an exact game-name match in any variant, majority vote for the
  character name, the difficulty popup recognised by its labels, case-insensitive names) when the session stopped.
  The container restarted before it pushed anything: Batch 5 is not on the branch (head `eb97b70`) and must be
  written again from the diagnostics above.
- Next: read the branch's `tasks.md` (Batch 5) and the latest `ocr-real` log; finish until `ocr-real` shows
  `0 of 5 files FAIL` and the `agent` job is green; then architecture and security reviews, then merge. Never loosen
  the game-name rule: a wrong name stays refused.

### `fix/F1-room-view-500`

- `@LBR-07` failed once in CI (PR #56): `GET /v1/me/room` answered 500 for a member right after the host left. It is
  intermittent (it passed in #54 and #55). A 500 is a product bug.
- A worker pushed one unverified commit before the container restarted: `bc9a316` "read a room, its members and its
  run in one snapshot". Whether its gates ran and whether a deterministic test exists is unknown; check both.
- Next: the cause with evidence, a deterministic test, `@LBR- --repeat-each=10` green; open the PR into `phase/F1`,
  architecture review, merge.

### API preview of the phase PR (#41)

- Live: the label `render-preview` is on #41. Site `https://phase-f1.d2rmatchmaking.pages.dev` proxies to the API
  `https://d2rmm-api-pr-41.onrender.com`, which has its own Neon branch `preview/pr-41` (run 43140520497 green).
- Battle.net sign-in is off (`bnetSignIn: false`) until the keys exist. The maintainer creates the OAuth client at
  develop.battle.net with the redirect URLs `https://d2rmatchmaking.pages.dev/api/v1/auth/bnet/callback` and
  `https://phase-f1.d2rmatchmaking.pages.dev/api/v1/auth/bnet/callback`, then sets `BNET_CLIENT_ID` and
  `BNET_CLIENT_SECRET` on the Render services `d2rmm-api` and "d2rmm-api PR #41".
- Then add both keys with `sync: false` to `render.yaml` (names only, no values).

### `feat/F0-parallel-cloud-spike`

An F0 spike from an earlier session. Its last two local commits (the cloud measurement and the quoted prompt) could
not be pushed before the machine was cleaned; the remote branch stays at `87be3b5`. Not part of F1.

## Follow-ups to carry into the review (`decisions.md`)

- A per-account limit on the ready-check answer routes (security review of #52, low) — F2.
- A next-due short-circuit in `ClockScheduler` past NFR-14 (architecture review of #52).
- The site should retry while the free Render API wakes up (a cold start of 30–60 s shows "something went wrong").
- Signing the agent and the `ocr-check` tool: Windows App Control blocked the unsigned tool on the maintainer's PC
  (a code-signing certificate or SignPath: money and setup, the maintainer's decision).
- Ten Dependabot PRs are open against `main`.

## How to resume

`/phase-run F1` in a new session: finish PR #50 (Batch 5, driven by `ocr-real`), finish `fix/F1-room-view-500`, then
`/phase-review F1` (exit criteria with proofs; the full `pnpm test:load` run is the review's NFR-14 proof; the
maintainer's production sign-in and one real J1 game are manual proofs). Remove each worker's worktree once its branch
is pushed (lesson: finished worktrees filled the disk).
