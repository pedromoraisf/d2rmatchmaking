# Phase F3 — Open rooms

**Goal**: The product the maintainer wants to launch, end to end with platform rooms and in the approved identity. A
signed-in player opens the list of open rooms, filters it, creates a room or joins one directly, or presses quick
match; the room, in-game and profile screens follow the design canvas. In parallel the agent learns to read the D2R
game-search screen, sending nothing yet, so that F4 (rooms spotted in game) only has to list what is read.
**Roadmap**: .specs/phases/ROADMAP.md#f3
**Status**: DRAFT — waiting for the maintainer's answers below and the approval line

## How F3 runs

The lean flow of ADR 029 (`.claude/skills/d2rmm-phase-runner/SKILL.md`): per feature a spec with its Gherkin
scenarios, a design only when Large or Complex, a task checklist, one PR into `phase/F3` merged when CI is green.
Mutation runs in the nightly. The maintainer approves this brief and the review; in between only the escalations of
AGENTS.md and the inputs below reach them.

Where the work runs is what F2 settled (`docs/engineering/cloud-sessions.md`):

- **Orchestrator and workers are cloud sessions** in the environment "d2rmatchmaking". Workers are titled
  "ORQ012 · <feature>", run on Sonnet (ADR 031) on `feat/F3-<feature>`, and draft their own spec, scenarios and tasks
  as batch 0, which the orchestrator reviews before batch 1. **At most 3 workers at a time.**
- **Real prints never enter the repository.** The game-search prints reach CI the way F2's did (the encrypted
  real-print archive read by `ocr-real`); tuning against them happens only there and on the maintainer's machine.
- **The visual reference is in the repository**: `docs/design/canvas/project/<Artboard>.dc.html` and
  `docs/product/direction-2026-11.md`. A worker rebuilds a screen with tokens and components and never pastes the
  canvas's inline styles (ADR 041). Where the canvas and a requirement disagree, the requirement wins and the PR says
  so.
- **Contracts are edited by one feature at a time** (AD-035): the "Depends on" column orders the features that change
  `packages/contracts`.

## Exit criteria

Every item needs a proof in the phase review.

- [ ] **First: the pt-BR selection screen is read** (regression found 2026-11-24 on a fresh staging database,
      `docs/engineering/incidents/2026-11-24-pt-br-selection-screen.md`): with the game in pt-BR the agent recognises
      the character selection screen and reads the cards, so a new player can add characters. Proof: `ocr-real` green
      on the maintainer's two pt-BR selection prints, `ocr-variations` not regressing, and one fresh account on
      staging adding a character from a pt-BR client.
- [ ] **The room list is the main screen (FR-25).** A signed-in player sees the open rooms of their region, filters by
      origin, activity, difficulty, ladder and core, "only rooms with a free slot" and "only rooms my character can
      join", sees the empty state with its two calls, and the list updates live within NFR-01. Every row carries its
      origin; in F3 every row is a platform room. Proof: `@FR-25` scenarios; the maintainer's run on staging.
- [ ] **Create and join (FR-37, FR-26, FR-14, FR-31).** A player creates a room from the list with activity,
      difficulty and predefined tags, becomes its host and the room is listed while it has a free slot. Another player
      joins it directly, with no queue and no ready check, under FR-08, FR-09 and FR-31. A leveling room accepts a join
      while active; a PvP room only while it forms. A slot freed by a member who leaves reopens on the list. Proof:
      `@FR-37`, `@FR-26`, `@FR-14`, `@FR-31` scenarios; a staging run with bots that join an open room.
- [ ] **Quick match replaces the matchmaking page (FR-06, FR-07, FR-12).** The button on the list queues with the
      activity and difficulty of the filters and the active character, asks only what the filters lack, and keeps the
      player on the list while it searches. A found party opens the ready check over the list; the ready check exists
      nowhere else. Joining or creating a room cancels the ticket. The `/matchmaking` page is gone. Proof: `@FR-06`,
      `@FR-07`, `@FR-12` scenarios; J1 and J2 on staging with bots.
- [ ] **Room and in-game screens (FR-18).** The room screen shows the game name, the steps, the party and the stage
      for host and member; the in-game screen shows the run, its clock, party presence, the run history and the next
      run's name before the host starts it with one button. Proof: `@FR-18`, `@FR-15`, `@FR-16` scenarios.
- [ ] **Profile (FR-02, FR-04, FR-05).** Characters read by the agent, ladder and era declared there once per
      character, a character without them blocked from rooms and queues with the reason shown, agent status, pairing a
      new PC in place of the current one, language and the accept hotkey. Proof: `@FR-02`, `@FR-04`, `@FR-05`
      scenarios.
- [ ] **Identity and design system (ADR 041, NFR-12, NFR-13).** Home, room list, room, ready check, in game and
      profile are built from tokens and shared components. No raw colour or font outside the tokens file (lint); every
      text and mark pair passes AA (contrast tests); every screen is operable by keyboard; every string exists in
      English and pt-BR; at 390 px wide no screen scrolls sideways except the room table inside its own box. The agent
      window uses the same tokens. No Blizzard asset is in the repository or on the site. Proof: the lint rule, the
      contrast tests, `@NFR-13` scenarios, a Playwright viewport check, `scripts/check-images.mjs`.
- [ ] **The game-search screen is read (FR-33).** On the maintainer's real prints, in English and pt-BR clients,
      windowed and full screen, the agent recognises the game-search screen and reads the rows of the game list (name,
      player count), the selected game's details, and the game's answer to a join attempt (does not exist, full,
      other). **Zero wrong readings**: a row or an answer is read correctly or refused, never read as another. The
      agent sends none of it: no new route, no new observation kind. The number of OCR calls per look on that screen
      stays inside the NFR-02 budget. Proof: `ocr-real` green on the new prints, `ocr-variations` counts with a floor
      and a ceiling, a source-rule test that nothing is sent, unit tests on drawn fixtures.
- [ ] **Load (NFR-14).** The nightly's journey includes the room list: 100 or more players, 0 errors, and bytes per
      player-hour at or below **125,000** (416,567 at the end of F2). Proof: the nightly report.
- [ ] **Telemetry carry-overs from F2 closed**: the agent's spans carry `service.name` and their trace ids keep 32
      hex digits; the telemetry egress decision (input 6) is applied. Proof: a TraceQL query on staging and the
      nightly egress figure.
- [ ] **Journeys are checked from an empty database, in English and pt-BR** (lessons, 2026-11-24). Proof: the
      maintainer's staging run starts from a fresh account in each language.
- [ ] **Nightly green three nights in a row** on `phase/F3` before the review: acceptance, load, quality ratchet, and
      mutation with no unexplained survivor in the code F3 adds. Proof: the three run links.

## Features

| Feature                 | Size    | Depends on                 | Parallel | Canvas  | Covers                                                 |
| ----------------------- | ------- | -------------------------- | -------- | ------- | ------------------------------------------------------ |
| `pt-br-select-screen`   | Small   | two pt-BR prints (input 7) | first    | —       | FR-02 (regression)                                     |
| `agent-telemetry-fix`   | Small   | —                          | yes      | —       | NFR-09 (F2 carry-over)                                 |
| `design-system`         | Medium  | ADR 041 accepted           | first    | 01      | NFR-12, NFR-13                                         |
| `game-search-reading`   | Complex | the real prints (input 1)  | yes      | —       | FR-33, NFR-02, NFR-03, NFR-04                          |
| `room-list`             | Large   | — (site: `design-system`)  | yes      | 03      | FR-25, NFR-01, NFR-14                                  |
| `open-rooms`            | Large   | `room-list`                | after it | 03, 03b | FR-37, FR-26, FR-14, FR-15, FR-31, FR-08, FR-09, FR-32 |
| `quick-match`           | Medium  | `open-rooms`               | after it | 03, 04  | FR-06, FR-07, FR-12, FR-13                             |
| `room-screens`          | Medium  | `design-system`            | yes      | 03b, 05 | FR-18, FR-15, FR-16, FR-17                             |
| `profile`               | Medium  | `design-system`            | yes      | 07      | FR-02, FR-04, FR-05                                    |
| `site-home`             | Medium  | `design-system`            | yes      | 02      | FR-01, FR-03, FR-29 (entry points)                     |
| `agent-window-identity` | Small   | `design-system`            | yes      | —       | NFR-12                                                 |
| `stream-budget`         | Medium  | `room-list`                | after it | —       | NFR-14                                                 |

Primary in F3 (roadmap): FR-25, FR-26, FR-33, FR-37. The other requirements were proved in F1 or F2; F3 revises their
wording or their interface (AD-180…AD-182) and its review proves the revised behaviour.

What each feature is:

- **`pt-br-select-screen`** (agent, runs first): the agent never recognises the selection screen of a pt-BR client
  ("Tela: não reconhecida" in every capture mode; English works). No real pt-BR selection print was ever in the
  real-print archive, and the saved characters of the old staging database hid it. `ocr-check` learns a pt-BR
  selection print, the fix follows rule 14 (drawn fixture first, then the real-print proof), and the journey is
  checked again from an empty database.
- **`agent-telemetry-fix`**: the agent's resource carries `service.name`; its trace ids keep leading zeros; the
  egress decision (input 6) is applied.
- **`design-system`**: `packages/design-tokens` (tokens, self-hosted fonts), `apps/web/src/shared/ui` components, the
  page shell with the header (Open rooms, agent status, profile chip; Ranking stays out until F5), the lint rule and
  the contrast tests, the breakpoints every screen uses on a phone.
- **`game-search-reading`**: agent only, under rule 14. Screen recognition gains the game-search screen; new reading
  modules for the list, the selected game and the join answers, in English and pt-BR, listed in
  `scripts/agent/reading-modules.json`; phrases and regions in the remote configuration. It also checks, on the
  prints, whether the game list can show a game with a password (ADR 040, item 7).
- **`room-list`**: the list query and its stream (snapshot plus coalesced changes, `origin` on every row), the
  filters, compatibility with the active character, the empty state, the list screen.
- **`open-rooms`**: creating a room from the list, the direct join, joins into an active leveling room, tags, slots
  that reopen, the revised invariants (INV-03, INV-04, INV-06), and the staging bots joining an open room.
- **`quick-match`**: the button, the short step for what the filters lack, the searching banner, the ready check over
  the list, cancelling on join, removing the matchmaking page.
- **`room-screens`**: the room before the game and the run in progress, restyled; the next run's name shown ahead; the
  expired, closed and left states.
- **`profile`**: characters, ladder and era, agent status and re-pairing, language switcher, the hotkey.
- **`site-home`**: the landing page with original hero art, the non-affiliation notice, sign-in, the agent download
  and the pairing steps (J4) in the new identity.
- **`agent-window-identity`**: the desktop agent's window on the shared tokens.
- **`stream-budget`**: the cuts that bring bytes per player-hour to the target, with the list in the load journey.

Order of dispatch: `pt-br-select-screen` when its two prints arrive, `design-system` and `room-list` (API part) first, `game-search-reading` as soon as the prints
arrive; then the screens in parallel, three workers at a time.

### Not designed yet, and the feature that designs it

Each is drawn by its feature from the tokens and components, described in the PR with a screenshot, and listed in
`decisions.md` for the review.

| Not designed                                                   | Feature                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| The form to create a room (activity, difficulty, tags)         | `open-rooms`                                                       |
| The quick-match step for format, rules, role and minimum level | `quick-match`                                                      |
| Room states: expired, closed, left, host changed               | `room-screens`                                                     |
| Sign-in, agent download and pairing in the new identity        | `site-home`                                                        |
| Phone layouts beyond wrapping                                  | each screen's feature, on `design-system`'s breakpoints            |
| The desktop agent's window in the new identity                 | `agent-window-identity`                                            |
| The detail view of a spotted room                              | F4 (`spotted-list`); not in F3                                     |
| The sightings switch on the profile                            | F4 (`sighting-consent`); `profile` leaves its place in Preferences |

## Decisions already taken

- The visual identity is approved (maintainer, 2026-11-28: "Aprovo a identidade."). AD-185.
- The roadmap has seven phases; the room list comes before the competition; spotted rooms are F4 (AD-178, AD-179).
- The PRD rewording of FR-02, FR-06, FR-07, FR-12, FR-14, FR-18, FR-25, FR-26 and FR-31, and the new FR-37
  (AD-180…AD-182, from the decisions of the design session).
- The 16 questions of the replanning were shown with the conservative option marked; the maintainer answered the
  identity and the prints and told the runner to proceed (2026-11-28: "Depois que atualizar todos os documentos, vá
  para o planejamento da F3"). The options adopted, which this brief's approval confirms (AD-183, AD-184, AD-186):
  - the list is for signed-in players, shows only the player's region, and uses the glossary's activities (Heralds
    included; no generic rush, no 4v4);
  - a room created from the list has predefined tags and no free text until moderation exists (F6);
  - a leveling room accepts joins while active; a PvP room only while it forms;
  - quick match needs an activity and a difficulty chosen and asks the rest in one short step;
  - joining or creating a room cancels a quick-match ticket; the canvas's game names are illustrative (ADR 017
    stands); "Pair another PC" replaces the paired agent (AD-037 stands); characters still come from the
    character-select screen; the language switcher is built; Ranking is out of the menu until F5;
  - the hero uses original art; the rule on Blizzard material stands;
  - spotted rooms (F4): listed only from the game-search screen, name and counts only, opt-in, stale at 5 minutes and
    removed at 10, removed only by "does not exist", owned by Lobby Room in memory.
- The 125,000 bytes per player-hour target that F2 deferred is an F3 exit criterion (AD-186; F2 brief Revision 4).
- Mutation only in the nightly; zero wrong readings before correct readings; no real print in the repository.
- Field validation on the game PC is kept short: the maintainer validates journeys on staging with the staging bots,
  and broader field runs happen after launch if errors call for them (maintainer, 2026-11-24: "Qualquer coisa
  pós-lançamento, depois de todas as fases, se chegarmos a cenário de bastante erro, refazemos a jornada desta forma
  ou de outras."). Staging follows `phase/F3` during the phase (`docs/engineering/delivery.md`).
- This brief replaces the draft of 2026-11-24 for an F3 "Competition" (commits 8749509c and a3d07c60 on `phase/F3`).
  Its competition features, its questions on seasons and dispute prints and its 1v1 options are the input of the F5
  kickoff; its pt-BR regression, telemetry fix and egress question are carried here.

## What I need from you

1. **The real prints of the game-search screen**, added to the encrypted real-print archive like F2's. English and
   pt-BR clients, windowed and full screen: the game list with several games (top and scrolled), one game selected
   with its details, and each answer the game gives to a join attempt (does not exist, full, any other refusal).
   `game-search-reading` starts when they arrive; nothing else waits for them.
2. **Accept ADR 041** (design system and tokens), or say what to change. `design-system` is the first feature and
   every screen depends on it. ADR 039 and ADR 040 can wait until the F4 kickoff; `room-list` only carries `origin`
   in its contract.
3. **The 125,000 bytes target as an F3 exit criterion** — options: (a) keep it as written; (b) F3 only may not get
   worse than the current ceiling of 447,000, and the target moves to F6. Recommendation: (a), because the live list
   is where the stream is redesigned anyway and the target has been deferred twice.
4. **New ratchet metrics for the game-search reading** (correct floor, wrong ceiling at 0), added to
   `.quality-baseline.json` after the first green run, as F2 did for the Party panel. The baseline is yours (rule 4).
5. **The hero art.** Default: a scene drawn in code around the mascot. If you want an illustration of your own
   (nothing made from Blizzard art), hand it over before `site-home` starts.

6. **Telemetry egress (AD-128, asked in the 2026-11-24 draft).** T12 measured a share of about 1.89 of the 5 GiB
   budget at the production ratio, the agent's vision spans being about 43 %. Options: (a) in production, export only
   the agent's room-path spans and sample the per-frame vision spans at 1 % (staging keeps 100 %); (b) lower every
   production ratio to 1 %; (c) accept the share until there are players. Recommendation: (a), because the room path
   is what diagnoses a failed confirmation and the per-frame spans are where the bytes are.
7. **Two pt-BR selection prints**, for the first item: the selection screen with your characters listed, and the same
   with the difficulty popup open, added to the encrypted real-print archive with the game-search prints of input 1.
   Until the fix, playing with the client in English works.

## Out of scope

- Rooms spotted in game on the site and the server: sightings, the spotted section, copy name, expiry, the consent
  switch (F4, FR-34…FR-36). In F3 the agent reads the screen and sends nothing.
- PvP score, disputes, ELO, rune ranks and the Ranking screen (F5, FR-19…FR-24, FR-30).
- Moderation, free text in rooms, LGPD review, SignPath and agent promotion, ultrawide and 4:3, the 95 % share of
  synthetic variations (F4 and F6, AD-186).
- A public, signed-out view of the room list; a light theme; a region filter.
- The hero video and anything made from Blizzard art.

## Approval

<!-- **Approved**: <date> - user: "<maintainer's words>" -->
