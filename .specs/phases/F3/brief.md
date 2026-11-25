# Phase F3 — Competition

**Goal**: A PvP duel ends with a score both agents agree on, an ELO that moves only on a confirmed or moderated result,
ranking boards per difficulty, and live rooms a player can join without queueing (journeys J3 and J5).
**Roadmap**: .specs/phases/ROADMAP.md#f3
**Status**: DRAFT — waiting for the maintainer's answers below and the approval line

## How F3 runs

The lean flow of ADR 029 (`.claude/skills/d2rmm-phase-runner/SKILL.md`): per feature a spec with its Gherkin
scenarios, a design only when Large or Complex, a task checklist, and one PR into `phase/F3` merged when CI is green.
Mutation runs in the nightly. The maintainer approves this brief and the review; in between only the escalations of
AGENTS.md and the questions below reach them.

As at the end of F2: the orchestrator runs in the cloud, at most 3 workers at a time (Sonnet, ADR 031). Staging follows
`phase/F3` during the phase (`docs/engineering/delivery.md`), and journeys are proven on staging with the staging bots
(`/staging-bots`), which gain a score-reporting mode in this phase so a lone tester can play a full duel.

## Exit criteria

- [ ] **First: the pt-BR selection screen is read** (regression found 2026-11-24 on a fresh staging database): with the
      game in pt-BR the agent recognises the character selection screen and reads the cards, so a new player can add
      characters — proof: `ocr-real` PASS on the maintainer's new pt-BR selection prints, `ocr-variations` not regressing,
      and one fresh account on staging adding a character from a pt-BR client.
- [ ] **J5 — score and dispute**: in a PvP duel, a round counts only when both agents' readings of the death message
      match; a divergence first tries pairing the two sides' data, then goes to the room's moderator, who decides with
      prints as evidence; leaving an active duel is a loss by W.O. — proof: `@FR-19`, `@FR-20`, `@FR-21`, `@FR-30`
      scenarios green in the nightly acceptance run, and one duel on staging with the bots (score confirmed, one forced
      divergence resolved).
- [ ] **ELO**: rating per character × difficulty × season, classic ELO with K = 32 (ADR 018), changed only by a
      confirmed or moderated result (INV-14, INV-15) — proof: `@FR-22` scenarios, domain unit tests, and the nightly
      mutation scores of the Ranking domain and application at or above the floors.
- [ ] **Ranking boards** per difficulty: PvP by ELO, Leveling by runs, the player's own positions, rune ranks by ELO
      band — proof: `@FR-23`, `@FR-24` scenarios.
- [ ] **J3 — live rooms**: list rooms with a free seat, filter by mode and difficulty, show whether the character fits,
      join without the queue — proof: `@FR-25`, `@FR-26` scenarios, and one join on staging.
- [ ] **Death-message reading** on drawn fixtures in pt-BR and English, with `ocr-real` and `ocr-variations` not
      regressing (rule 14) — proof: the reading module's unit tests and the per-PR `ocr-variations` counts.
- [ ] Load: the nightly still holds ≥ 100 concurrent players (NFR-14) with the score and ranking paths in the journey —
      proof: nightly `load`.
- [ ] Carry-overs from F2 closed: the agent's spans carry `service.name`, and their trace ids keep 32 hex digits;
      the telemetry egress decision below is applied — proof: a TraceQL query on staging and the nightly egress figure.

## Features

| Feature               | Size   | Depends on   | Parallel | Covers              |
| --------------------- | ------ | ------------ | -------- | ------------------- |
| `pt-br-select-screen` | Small  | —            | yes      | FR-02 (regression)  |
| `pvp-score`           | Large  | —            | yes      | FR-19, FR-21        |
| `death-reading`       | Large  | —            | yes      | FR-19 (agent side)  |
| `elo-rating`          | Medium | `pvp-score`  | no       | FR-22, FR-24        |
| `ranking-boards`      | Medium | `elo-rating` | no       | FR-23               |
| `disputes`            | Large  | `pvp-score`  | no       | FR-20, FR-30        |
| `live-rooms`          | Medium | —            | yes      | FR-25, FR-26        |
| `agent-telemetry-fix` | Small  | —            | yes      | F2 carry-over (OBS) |
| `staging-bots-score`  | Small  | `pvp-score`  | no       | test support (J5)   |

- **`pt-br-select-screen`** (agent, runs first): the agent never recognises the selection screen of a pt-BR client
  ("Tela: não reconhecida" in every capture mode; English works). No real pt-BR selection print was ever in
  `real-prints.zip`, so `ocr-real` could not see it, and the persisted characters of the old staging database hid it.
  `ocr-check` learns a pt-BR selection print (its own file name), the fix follows rule 14 (drawn fixture first, then
  the real-print proof), and the journey is re-checked from an empty database.
- **`pvp-score`** (Lobby Room): `ScoreReport` per round from each side's observation; a round counts when the two
  readings match (FR-19); leaving an active duel is a W.O. loss, leveling has no penalty (FR-21, INV-13); emits
  `MatchResultConfirmed` and `MemberAbandoned` through the outbox. Route `POST /lobby-rooms/{id}/score-reports`
  (design doc § API). Contracts first.
- **`death-reading`** (agent): reads the death message of a duel round from the chat area, in pt-BR and English, and
  posts it as an observation. A reading module under rule 14: drawn fixtures first, the real-print proof when a non-test
  line of a reading module changes.
- **`elo-rating`** (Ranking): `Rating` and `Season`, ELO K = 32 behind a port (ADR 018), only from
  `MatchResultConfirmed` or a moderator's decision; runs counted from `RunCompleted`; rune ranks by ELO band (FR-24).
- **`ranking-boards`** (site + API): boards per difficulty, PvP by ELO and Leveling by runs, with the player's
  characters' positions (FR-23). i18n en and pt-BR.
- **`disputes`** (Lobby Room + site): step 1 pairs both agents' data again; step 2 hands the round to the room's
  moderator by hierarchy (host, then members by join order, FR-30), who sees the round history and the prints and
  decides. Prints are uploaded only on the player's action and kept at most 30 days in R2 (NFR-04/05). Security review.
- **`live-rooms`** (Lobby Room + site): `GET /lobby-rooms?status=open&mode=&difficulty=`, the character fit (same
  filters as the queue: region, difficulty, ladder, era), and joining a room with a free seat without the queue.
- **`agent-telemetry-fix`**: the agent's resource carries `service.name`; its trace ids keep leading zeros; the egress
  decision (question 4) is applied.
- **`staging-bots-score`**: the bots report rounds (both agree, or a chosen divergence) so a lone tester reaches a
  confirmed score and a dispute on staging.

## Decisions already taken

- ELO per character × difficulty × season, classic K = 32, only from double-confirmed results (ADR 018, accepted).
- Declining a ready check carries no penalty for now (maintainer, 2026-11-10: "Não. Hoje não deve acontecer nada").
- Field validation on the game PC is kept short: the maintainer validates journeys on staging themselves, with the staging
  bots, and broader field runs happen after launch if errors call for them (maintainer, 2026-11-24: "Qualquer coisa
  pós-lançamento, depois de todas as fases, se chegarmos a cenário de bastante erro, refazemos a jornada desta forma ou
  de outras.").
- Signing (SignPath, agent-release T9–T12) and the agent promotion design (delivery-platform T11b-2) go to F4, where
  the roadmap places signing; production setup and the cutover happen when the maintainer wants players, not as an F3
  exit criterion.

## What I need from you

1. **The 1v1 dispute (ROADMAP, required before this kickoff).** In a duel the host is also a player, so step 2 of
   INV-11 would let the host decide their own dispute. Options:
   a. **The round is void**: when the pairing (step 1) cannot settle a 1v1 round, the round does not count for either
   side and the ELO does not move; the prints stay 30 days for a later report.
   b. **Both must agree**: either player proposes the result and the other accepts; with no agreement the round is void
   (as a).
   c. **An external moderator**: an admin role on the platform decides 1v1 disputes (needs an admin area; more work).
   Recommendation: **a** — no one decides their own case, it needs no admin role in the MVP, and ELO only moves on
   agreed data (INV-14). Groups (2v2, arena) keep the hierarchy of FR-30, with the host excluded when the host is a
   party to the round.
2. **Where seasons start.** Options: a. one open season from launch until you close it; b. fixed seasons (for example
   quarterly). Recommendation: **a**, with a script to close a season and open the next (an admin task, ADR 032 XII).
3. **Prints for disputes in R2.** The dispute upload needs an R2 bucket (or a prefix of the backups bucket) with a
   30-day lifecycle rule and a token scoped to it, set as secrets in Render (staging first). Options: a. a separate
   bucket `d2rmm-dispute-prints` (recommended: its own token and lifecycle); b. a prefix in the existing bucket. I will
   give the exact steps when `disputes` reaches that task.
4. **Telemetry egress (AD-128).** T12 measured a share of about 1.89 of the 5 GiB budget at the production ratio, the
   agent's vision spans being about 43%. Options: a. in production, export only the agent's room-path spans and sample
   the per-frame vision spans at 1% (staging keeps 100%); b. lower every production ratio to 1%; c. accept the share
   until there are players. Recommendation: **a** — the room path is what diagnoses a failed confirmation, and the
   per-frame spans are where the bytes are.
5. **Real death-message prints (optional).** Drawn fixtures are enough to build `death-reading`; a few real pt-BR prints
   of a duel death message, kept on your PC like the others, would let `ocr-real` guard it. Options: a. you capture
   5–10 when convenient; b. drawn fixtures only. Recommendation: **a**, at no fixed time; the feature does not wait for
   them.

6. **pt-BR selection prints (needed for the first item).** Two prints from your pt-BR client, kept on your PC: the
   selection screen with your characters listed, and the same with the difficulty popup open. When the fix PR names
   the files, you add them to `real-prints.zip` (7-Zip, AES-256, the same password) and I take it from there. Until
   then, playing with the client in English works.

## Out of scope

- Production setup and the cutover (done when the maintainer chooses; `docs/engineering/delivery.md`).
- Signing, the agent promotion design, moderation beyond room disputes, LGPD, regions and the beta (F4).
- Glicko-2 or any rating other than ADR 018's ELO.

## Approval

<!-- **Approved**: <date> - user: "<maintainer's words>" -->
