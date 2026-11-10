# Phase F1 — Match core

**Goal**: J1 (ranked duel, steps 1 to 5) and J2 (leveling session, steps 1 to 5) playable end to end: Battle.net
sign-in, characters read by the agent, queues, ready check and rooms whose presence the agents confirm.
**Roadmap**: .specs/phases/ROADMAP.md#f1
**Status**: DRAFT — waiting for the maintainer's answers below and the approval line

## How F1 runs (the lean flow)

F1 is the first phase on the lean harness agreed on 2026-11-10 (the `harness-lean` change merges before F1 starts;
its ADR supersedes ADR 021, 022, 025 and 028). Per feature:

1. `spec.md` (EARS requirements traced to the PRD) and `acceptance.feature` (Gherkin, one scenario or more per
   requirement ID). `design.md` only for features sized Large or more. No approval line per feature: this brief's
   approval covers every spec inside its scope.
2. A task checklist in `tasks.md`, implemented by `feature-worker`s on `feat/F1-<feature>`.
3. One PR into `phase/F1`, with the decisions taken in its description. Architecture and security reviewers comment on
   the diff once. The PR merges by itself when CI is green.
4. Mutation testing runs in the nightly only; the phase review reads the nightly report.

What reaches you during the phase: the escalations of AGENTS.md (secrets, production database, repository settings,
money) and the inputs listed under "What I need from you". Everything else waits for the review.

## Exit criteria

Every item needs a proof in the phase review.

- [ ] Sign in with Battle.net, session cookie through the Pages proxy, sign-out (FR-01) — proof: `@FR-01` scenarios
      against a fake OAuth server in CI + your sign-in on production
- [ ] Revoking an agent on the site cuts its token at once (FR-04) — proof: `@FR-04`
- [ ] The site shows the agent online, the game open and the current screen (FR-05) — proof: `@FR-05`
- [ ] The agent registers characters from the character selection screen: name, class, level, ladder or hardcore, and
      the title that unlocks difficulties, with the game client in English and in Portuguese (FR-02, NFR-12) — proof:
      unit tests on real screenshots + your Windows check
- [ ] PvP and leveling queues with every filter (region, difficulty, ladder, era) never relaxed; locked difficulties
      and levels under the minimum refused; the ELO band widens with waiting time; teleporter and BO guaranteed when
      queued; entry only with a paired online agent, linked account and connected site (FR-06 to FR-11, FR-31) —
      proof: unit tests on the matcher + `@FR-06`…`@FR-11`, `@FR-31`
- [ ] Ready check of 1 minute, accepted on the site or by the agent's hotkey; declining carries no penalty; not
      answering gives the 5-minute wait; members who accepted return to the top of the queue (FR-12, FR-13) — proof:
      `@FR-12`, `@FR-13`
- [ ] A room is created from the group with a host, the `mm{activity}{difficulty}-{n}` name and an empty password; it
      moves through Formed, Awaiting host, Created, Active, Closed and Expired; it expires when the host does not create
      the game in 3 minutes; the next run opens with a new name and the group is told (FR-14, FR-15, FR-17, FR-18) —
      proof: `@FR-14`, `@FR-15`, `@FR-17`, `@FR-18`
- [ ] Presence is confirmed by the agent reading the game name in a live game (FR-16; first version of FR-27, whose
      primary phase stays F2) — proof: unit tests on real screenshots + your Windows check
- [ ] A member whose site or agent stays disconnected past the tolerance leaves the room in a controlled way; a host
      who leaves hands the role to the next member by join order (FR-32) — proof: `@FR-32`
- [ ] Room state reaches the site within 2 s of the agent's observation, and the load run passes ≥ 100 players on the
      real journey (NFR-01, NFR-14 regression) — proof: e2e timing + `pnpm test:load` summary
- [ ] Every new screen works by keyboard and passes AA contrast; no hard-coded user-facing string, pt-BR complete
      (NFR-13, NFR-12) — proof: axe and keyboard checks in the acceptance run + the i18n lint
- [ ] J1 and J2 run end to end in CI with headless agents — proof: `@J1`, `@J2` in the CI run of the review

## Features

| Feature         | Size   | Depends on                   | Parallel             | Covers                                          |
| --------------- | ------ | ---------------------------- | -------------------- | ----------------------------------------------- |
| identity-bnet   | Medium | —                            | with characters      | FR-01, FR-04                                    |
| characters      | Large  | —                            | with identity-bnet   | FR-02, FR-05, NFR-12 (agent reading)            |
| agent-game-name | Large  | characters                   | with queues          | FR-16 (agent side), FR-27 (first version)       |
| queues          | Large  | characters                   | with agent-game-name | FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-31 |
| ready-check     | Medium | queues                       | no                   | FR-12, FR-13                                    |
| lobby-rooms     | Large  | ready-check, agent-game-name | no                   | FR-14, FR-15, FR-16, FR-17, FR-18, FR-32        |
| journeys-e2e    | Medium | lobby-rooms, identity-bnet   | no (last)            | NFR-01, NFR-12 (site), NFR-13, J1, J2           |

Notes:

- `identity-bnet` and `agent-game-name` get a security review on the diff (OAuth, cookies, agent capture).
- Until `identity-bnet` merges, the other features sign in through F0's staging-only test sign-in (AD-029).
- Before `ranking` exists (F3), every character queues with the initial rating of ADR 018; the ELO band logic is real.
- The agent hotkey for the ready check ships in `ready-check`; it calls the API and sends no input to the game.
- Parallel rows need one working directory per worker (F0 follow-up 2, fixed in `harness-lean`). If that slips, the
  rows run one at a time in this order.

## Decisions already taken

- **Declining a ready check carries no penalty, for now** (maintainer, 2026-11-10: "Não. Hoje não deve acontecer
  nada"). FR-13 and INV-05 change accordingly; the PRD copy in Claude Docs needs the same edit.
- **The 1v1 dispute question (INV-11 step 2)** belongs to FR-20/FR-30 in F3; it does not block F1.
- **Workers stay on Haiku** (ADR 025). Recorded as a hypothesis: if workers still need many retries after the lean
  harness, Sonnet is the next thing to try.

## What I need from you

1. **Live capture in F1.** FR-02 and FR-16 need the agent to read real screens, and AD-057 left live capture for F2.
   Proposal: F1 ships a first version (window capture, Windows OCR, fixed reading regions, English and Portuguese
   clients) and F2 keeps the cascade, fusion, remote config and the ≥ 95% read rate. Confirm, or say what to cut.
2. **Not answering the ready check.** I kept the 5-minute wait for someone who does not answer (a no-show holds the
   whole group for a minute; a decline frees it at once). Confirm, or make it no penalty too.
3. **Screenshots for the fixtures**, before `characters` and `agent-game-name` start: the character selection screen
   and an in-game automap with the game name, in English and in Portuguese, at the resolutions you play. I will list
   the exact shots in the feature specs.
4. **The real-world check.** J1 needs two players and J2 eight. Proposal: CI proves both journeys with headless agents;
   you play J1 once on production with one other person (or two Battle.net accounts on two PCs); J2 with real people
   waits for the F4 beta.
5. **Battle.net OAuth credentials** for staging and production (client id and secret in GitHub/Render secrets).

## Out of scope

Scores, disputes, ELO updates and ranking boards (F3); live rooms (F3); capture cascade, fusion, remote config,
assisted typing (F2); the macOS/Linux agent, Discord, console players (not in the MVP).

## Approval

<!-- **Approved**: <date> - user: "<maintainer's words>" -->
