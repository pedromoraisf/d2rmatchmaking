# Queues — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Large (see `design.md`) · **Security review**: no
(no auth, agent or edge change; entry rules read existing ports)

## Problem

Players need to queue for PvP or leveling with a character the agent registered, and be grouped only with players they
can actually play with: same game region, difficulty, ladder and era, never relaxed (FR-08, INV-01). The character must
have the difficulty unlocked and, in leveling, the level for it (FR-09, INV-02). Only players with an online paired agent,
a Battle.net account and the site open may queue (FR-31, INV-03), and an account holds at most one ticket or room
(INV-04). PvP widens the ELO band with waiting time (FR-10); leveling includes a teleporter and a BO when the pool has
them (FR-11). The ready check (`ready-check`) comes next; until it merges, a formed group goes straight to a room.

## Out of scope

| Item                                         | Why                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| Ready check, accept, decline, penalties      | `ready-check` (FR-12, FR-13)                                 |
| Rating changes, ranks                        | F3; every character queues with the initial rating (ADR 018) |
| Live rooms and joining a room past the queue | F3 (FR-25, FR-26)                                            |
| Keeping tickets across an API restart        | The queue lives in memory (Design Doc § Modelo de dados)     |

## Requirements

Entry

- **QUE-01** — WHEN a signed-in player asks to join the PvP queue with a character, a difficulty, a game region, a format
  (duel, 2v2, arena) and rules (GM, BM) THEN the API SHALL create a ticket and answer 201 with it (FR-06).
- **QUE-02** — WHEN a signed-in player asks to join the leveling queue with a character, a difficulty, a game region, an
  activity (Baal, Chaos, Cows, Terror Zone, Heralds), a role (teleporter, BO, killer, leech) and a minimum level THEN the
  API SHALL create a ticket and answer 201 with it (FR-07).
- **QUE-03** — IF the character is not the player's, its ladder and era are not declared yet (`characters` CHR-15),
  the difficulty is not unlocked on it, or, in leveling, its level is
  under the difficulty's floor (Normal 10, Nightmare 40, Hell 70) or under the chosen minimum, or the minimum is under
  the floor or above 99, THEN the API SHALL refuse with the reason and create no ticket (FR-09, INV-02).
- **QUE-04** — IF the activity is Heralds and the difficulty is not Hell or the character's era is not Reign of the
  Warlock THEN the API SHALL refuse with the reason.
- **QUE-05** — IF the player has no paired agent online, no Battle.net account, or no open site stream THEN the API SHALL
  refuse with the reason and create no ticket (FR-31, INV-03); a test account counts as linked only while staging
  endpoints are on.
- **QUE-06** — IF the player already holds a ticket or is a member of an open room THEN the API SHALL refuse with the
  reason (INV-04).

Matching

- **QUE-07** — The matcher SHALL group only tickets of the same mode, game region, difficulty, ladder and era, and, in
  PvP, the same format and rules, or, in leveling, the same activity; these filters SHALL never widen (FR-08, INV-01).
- **QUE-08** — In PvP, each ticket's band SHALL be its rating ± (50 + 25 for every full 30 seconds waited), up to ± 400,
  and two tickets SHALL match only when each rating lies in the other's band (FR-10).
- **QUE-09** — In leveling, a group SHALL form only when every member's character level is at least every member's
  chosen minimum.
- **QUE-10** — WHEN the pool of a leveling activity holds a compatible teleporter or BO THEN the group SHALL include one
  of each that the pool has, before other roles (FR-11).
- **QUE-11** — A group SHALL have 2 players in a duel, 4 in 2v2, 6 in an arena and 8 in leveling, taken oldest ticket
  first within the rules above; the matcher SHALL run when a ticket joins and every second.
- **QUE-12** — WHEN a group forms THEN its tickets SHALL leave the queue and Matchmaking SHALL publish `MatchFormed`
  with the members in ticket order (join order), the host (in leveling the teleporter, otherwise the oldest ticket), and
  in 2v2 two teams balanced by rating; until `ready-check` merges, the room opens from it directly.

Leaving

- **QUE-13** — WHEN a player leaves the queue THEN the API SHALL remove the ticket and answer 204; a ticket that is not
  the player's answers 404.
- **QUE-14** — WHEN the player's agent goes offline or is revoked, or the player's site stream stays closed for 30
  seconds, THEN the ticket SHALL leave the queue and the site SHALL be told why.

Site

- **QUE-15** — The site SHALL let the player choose mode, character, difficulty (locked ones disabled with the reason),
  region, and the PvP or leveling options, keep "Find match" disabled with the reason while an entry rule fails, show
  while queued the time waited, the PvP band, and the number of players in the same pool, and offer "Leave queue";
  within 2 seconds of each change (prototype "Partida" panel, NFR-01).
- **QUE-16** — Matchmaking SHALL record spans for joining, leaving and each matcher run, and metrics for the queue size
  and the wait at match, with mode, difficulty, ladder and era as attributes and no account or character name.
- **QUE-17** — Every new user-facing string SHALL come from the translation files in English and pt-BR, and the queue
  controls SHALL be usable by keyboard (NFR-12, NFR-13).

## Sources

| ID     | Source                                                                     |
| ------ | -------------------------------------------------------------------------- |
| QUE-01 | FR-06                                                                      |
| QUE-02 | FR-07                                                                      |
| QUE-03 | FR-09, INV-02; floors from the prototype; CHR-15 (ladder and era declared) |
| QUE-04 | Prototype ("Heralds: só Inferno, RotW"); FR-08                             |
| QUE-05 | FR-31, INV-03; AD-029 (test accounts on staging)                           |
| QUE-06 | INV-04                                                                     |
| QUE-07 | FR-08, INV-01                                                              |
| QUE-08 | FR-10, ADR 018                                                             |
| QUE-09 | FR-07                                                                      |
| QUE-10 | FR-11                                                                      |
| QUE-11 | PRD § Escopo (formats); prototype (group of 8)                             |
| QUE-12 | Design Doc § Eventos (`MatchFormed`); FR-14 (host)                         |
| QUE-13 | Design Doc § Contratos (`DELETE /queue/tickets/{id}`)                      |
| QUE-14 | FR-31, INV-03                                                              |
| QUE-15 | FR-06, FR-07, FR-09; NFR-01; prototype (maintainer, 2026-11-10)            |
| QUE-16 | AGENTS.md rule 10; Design Doc § Observabilidade                            |
| QUE-17 | NFR-12, NFR-13                                                             |

## Requirement Traceability

| Requirement ID | Story     | Proof                                                      |
| -------------- | --------- | ---------------------------------------------------------- |
| QUE-01         | Entry     | acceptance `@QUE-01`                                       |
| QUE-02         | Entry     | acceptance `@QUE-02`                                       |
| QUE-03         | Entry     | acceptance `@QUE-03` + domain unit tests (boundaries)      |
| QUE-04         | Entry     | acceptance `@QUE-04` + domain unit tests                   |
| QUE-05         | Entry     | acceptance `@QUE-05`                                       |
| QUE-06         | Entry     | acceptance `@QUE-06`                                       |
| QUE-07         | Matching  | domain unit tests on the matcher + acceptance `@QUE-07`    |
| QUE-08         | Matching  | domain unit tests (band boundaries) + acceptance `@QUE-08` |
| QUE-09         | Matching  | domain unit tests                                          |
| QUE-10         | Matching  | domain unit tests + acceptance `@QUE-10`                   |
| QUE-11         | Matching  | domain unit tests + acceptance `@QUE-11`                   |
| QUE-12         | Matching  | application unit tests + acceptance `@QUE-12`              |
| QUE-13         | Leaving   | acceptance `@QUE-13`                                       |
| QUE-14         | Leaving   | acceptance `@QUE-14`                                       |
| QUE-15         | Site      | acceptance `@QUE-15` + component tests                     |
| QUE-16         | Telemetry | unit tests with in-memory exporters                        |
| QUE-17         | Access    | i18n lint + keyboard steps in `@QUE-15`                    |

## Decisions (conservative defaults)

- Level floors Normal 10, Nightmare 40, Hell 70, and Heralds only in Hell with RotW, from the maintainer's prototype.
- Band: ± 50, + 25 per full 30 s waited, capped at ± 400; matching is mutual (both bands). The prototype's speed is a
  simulation; these are real-time values.
- Leveling groups are 8, as in the prototype; no smaller group forms after a timeout (not in the PRD).
- Initial rating 1500 for every character until Ranking exists (ADR 018 names no value; Elo's usual start).
- Test accounts may queue only while staging endpoints are on, so CI and staging can run J1/J2; production requires a
  Battle.net account.
- A ticket lost to an API restart is not recreated; the site shows the queue ended and the player joins again.
- The pool count on the site shows how many compatible tickets wait, never who.
