# Journeys end to end — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: no (no new route,
auth surface or agent capability; test code, the load journey and CSS only) — architecture review only

## Problem

Each F1 feature proves its own requirements. Nothing yet proves that a player gets from sign-in to a confirmed room in
one go, that the room's state reaches the site within 2 s across the whole journey (NFR-01), that the real journey holds
100 players (NFR-14), and that every F1 screen is usable by keyboard with AA contrast (NFR-13) and complete in pt-BR
(NFR-12, site). This feature closes the phase's last exit criteria: J1 and J2, steps 1 to 5, in CI with headless agents.

## Out of scope

| Item                                                 | Why                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| J1 step 6 and J2 step 6 (scores, ELO, ranking)       | F3                                                          |
| J2 step 4's fill hotkey (assisted typing)            | F2 (FR-28); in F1 the members type the name, agents read it |
| The maintainer's production sign-in and real J1 game | A manual proof of the phase review, needs OAuth secrets     |
| The agent's reading in Portuguese (NFR-12, agent)    | `characters-reading` / `agent-game-name` language packs     |
| New product behaviour                                | Gaps found here are fixed in the feature that owns them     |

## User stories

- As a duelist, I sign in, queue a PvP duel, accept the ready check and land in a room my agent confirms, without
  leaving the site's flow (J1).
- As a leveler, I join a group of eight with a teleporter and a BO, the teleporter hosts, every agent confirms, and the
  next run reaches all of us with its new name (J2).
- As a keyboard or low-vision user, I can do all of that without a mouse and read every screen.
- As the maintainer, I know the free infrastructure holds 100 players on the real journey.

## Requirements

- **JRN-01** — The acceptance suite SHALL run J1 steps 1 to 5 as one scenario: two players sign in with Battle.net (fake
  OAuth server), pair headless agents that register their characters, join the PvP queue for a duel on the same
  difficulty, one accepts the ready check on the site and the other with the agent's hotkey, the room is assigned with
  a host and an `mm` name with no password, the host's agent reads the game name (`created`) and the other's agent reads
  it (`active`). Tagged `@J1` (FR-01, FR-06, FR-12, FR-14, FR-15, FR-16).
- **JRN-02** — The acceptance suite SHALL run J2 steps 1 to 5 as one scenario: eight players with paired headless
  agents, among them one teleporter and one BO, join the same leveling activity and difficulty; the group of eight
  forms with both; after every member accepts, the teleporter is the host; the host's agent and then every member's
  agent read the game name until the room is `active`; the host opens the next run and every member's site and agent
  get the new name, and the agents' reading of it confirms run 2. Players other than the host and one member MAY hold
  their site as a stream client instead of a browser page. Tagged `@J2` (FR-06, FR-07, FR-11, FR-12, FR-14 … FR-16,
  FR-18).
- **JRN-03** — In JRN-01 and JRN-02, every room stage change the agents cause (`created`, `active`, run 2) SHALL show on
  the members' browser pages within 2 seconds of the agent's observation, measured on the real clock from the
  observation's request to the page showing it (NFR-01).
- **JRN-04** — The load run (`pnpm test:load`) SHALL drive the real journey: each player's agent and site, queue join,
  ready-check accept, room assignment and the host's and members' observations up to `active`, with at least 100
  concurrent players and the room state reaching the site within the NFR-01 limit for the run's percentile already
  set by `load-baseline` (NFR-14).
- **JRN-05** — Every F1 site screen (signed out, signed in home, pairing, characters, queue panel, searching, ready-check
  overlay, room panel, revoke) SHALL pass an automated accessibility scan for WCAG 2.1 A and AA rules with no violation,
  in the browser the acceptance suite runs (NFR-13).
- **JRN-06** — The steps of J1 that happen on the site (sign-in, choosing the character and queue, accepting, copying
  the game name, leaving) SHALL complete by keyboard alone, with focus visible on every control reached (NFR-13).
- **JRN-07** — Every F1 site screen SHALL show no untranslated key and no English source string when the site language
  is pt-BR, and the pt-BR catalogue SHALL hold every key of the English one (NFR-12, site).
- **JRN-08** — The theme's contrast test SHALL cover the `gold-dim` and `bad` button borders and their hover states, and
  `.sr-only` SHALL follow the standard visually-hidden pattern (`margin: -1px`, `padding: 0`) — the `site-shell` review
  follow-ups (PR #45) (NFR-13).

## Sources

| ID     | Source                                                                           |
| ------ | -------------------------------------------------------------------------------- |
| JRN-01 | PRD J1 steps 1–5; brief exit criterion "J1 and J2 run end to end in CI"          |
| JRN-02 | PRD J2 steps 1–5; brief exit criterion "J1 and J2 run end to end in CI"          |
| JRN-03 | NFR-01; brief exit criterion "Room state reaches the site within 2 s"            |
| JRN-04 | NFR-14; brief exit criterion "load run passes ≥ 100 players on the real journey" |
| JRN-05 | NFR-13; brief exit criterion "AA contrast … axe … checks"                        |
| JRN-06 | NFR-13; brief exit criterion "Every new screen works by keyboard"                |
| JRN-07 | NFR-12 (site); AGENTS.md rule 9                                                  |
| JRN-08 | NFR-13; `site-shell` architecture review (PR #45) follow-ups                     |

## Requirement Traceability

| Requirement ID | Story       | Proof                                                          |
| -------------- | ----------- | -------------------------------------------------------------- |
| JRN-01         | Duelist     | acceptance `@JRN-01 @J1`                                       |
| JRN-02         | Leveler     | acceptance `@JRN-02 @J2`                                       |
| JRN-03         | Latency     | timing assertions inside `@JRN-01` and `@JRN-02` (≤ 2 s)       |
| JRN-04         | Capacity    | `pnpm test:load` summary (not a scenario)                      |
| JRN-05         | Keyboard/AA | acceptance `@JRN-05` (axe on each screen)                      |
| JRN-06         | Keyboard/AA | acceptance `@JRN-06`                                           |
| JRN-07         | pt-BR       | acceptance `@JRN-07` + a unit test on the catalogues' key sets |
| JRN-08         | Keyboard/AA | `theme.test.ts` (not a scenario)                               |

## Decisions (conservative defaults)

- J2 runs with eight players because the PRD and QUE-11 fix a leveling group at eight; to keep CI time bounded, six of
  them hold their site as a stream client (the site's presence rule only needs an open site stream), and the host and
  one member use browser pages for the visible checks.
- J1 and J2 stop at step 5; nothing of F3 (scores, ELO) is stubbed in.
- The accessibility scan uses `@axe-core/playwright` with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` tags and no
  rule disabled; a violation is fixed in the screen, never excluded.
- NFR-01 is measured on the real clock even though the acceptance clock is controllable: the clock only drives expiry
  and the matcher tick, not delivery.
- A gap found here (a screen failing axe, a missing translation, a state not reaching the site) is fixed in this
  feature's PR when it is CSS, markup or a locale string, and recorded as a blocker on the owning feature otherwise.
