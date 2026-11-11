# Lobby rooms — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Large (see `design.md`) · **Security review**: no
(no new auth surface; agent observations already authenticated in F0) — architecture review only

## Problem

F0 opens a room in `awaiting_host` and moves it to `created` when the host's agent reports the game name. F1 needs the
whole room: a host named by the match, the `mm{activity}{difficulty}-{n}` name with an empty password (FR-14, ADR 017),
every stage (FR-15), member presence confirmed only by agents (FR-16, INV-06), expiry when the host does not create the
game in 3 minutes (FR-17, INV-07), the next run with a new name (FR-18), and members who drop leaving in a controlled
way with the host role passing on (FR-32, INV-12). Presence is read in the Party panel (`agent-game-name`).

## Out of scope

| Item                                      | Why                                                 |
| ----------------------------------------- | --------------------------------------------------- |
| Scores, W.O., disputes, ELO               | F3                                                  |
| Live rooms, joining a room past the queue | F3 (FR-25, FR-26)                                   |
| Filling the game name by hotkey           | F2 (FR-28)                                          |
| Manual presence confirmation              | Never (Design Doc: "Não existe confirmação manual") |

## Requirements

- **LBR-01** — WHEN `MatchFormed` arrives THEN Lobby Room SHALL open a room `formed` with the members in join order, the
  host the match names, run 1 named `mm{activity}{difficulty}-{n}` (ADR 017; `pvp` as the activity code in PvP) and no
  password, and SHALL tell every member's site and agent (`room.assigned`).
- **LBR-02** — WHEN the host's agent has fetched or received the assignment THEN the room SHALL move to `awaiting_host`.
- **LBR-03** — WHEN the host's agent reports `GAME_NAME_SEEN` with the current run's name THEN the room SHALL move to
  `created` and the host SHALL be confirmed for that run (INV-06).
- **LBR-04** — WHEN another member's agent reports `GAME_NAME_SEEN` with the current run's name after `created` THEN that
  member SHALL be confirmed for the run; WHEN every member is confirmed THEN the room SHALL move to `active`.
- **LBR-05** — IF the room is still `awaiting_host` 3 minutes after it entered that stage for the current run, or still
  `formed` 3 minutes after it opened, THEN it SHALL move to `expired`, every member SHALL be released (free to queue) and
  told why (INV-07).
- **LBR-06** — WHEN the host asks for the next run on the site while the room is `active` THEN the room SHALL open run
  n + 1 with the next name of the sequence, clear the confirmations, return to `awaiting_host` (its 3-minute expiry
  starting again) and tell every member's site and agent (`room.run_opened`).
- **LBR-07** — WHEN a member leaves on the site THEN they SHALL leave the room; IF they were the host THEN the host role
  SHALL pass to the remaining member with the lowest join order; IF no member remains THEN the room SHALL close.
- **LBR-08** — IF a member's agent stays offline, or their site stream stays closed, for longer than the configured
  tolerance (default 60 s, `ROOM_DROP_TOLERANCE_SECONDS`) THEN they SHALL leave the room as in LBR-07 and the others
  SHALL be told (FR-32, INV-12).
- **LBR-09** — The host MAY close the room on the site; the room SHALL move to `closed` and release every member.
- **LBR-10** — An account in a room that is not `closed` or `expired` SHALL be refused by the queue (`in-room`, INV-04).
- **LBR-11** — Every stage change, confirmation, member change and new run SHALL reach the members' sites within 2
  seconds of the agent's observation or the action (NFR-01).
- **LBR-12** — The site SHALL show the room as the prototype's room panel inside the site shell: stage stepper (Formed,
  Awaiting host, Created, Active), the game name with a copy button and "No password", the steps for host and members
  (create a public game; open the Party panel and click the eye so the agent can read the name), members with host mark,
  class, level and presence (waiting, confirmed by the agent), the run history, and Leave / Next run / Close for whom
  they apply; usable by keyboard; en + pt-BR.
- **LBR-13** — Lobby Room SHALL record spans for each use case and metrics for rooms by final stage and time to
  `active`, with room, run, difficulty and activity attributes and no names.

## Sources

| ID     | Source                                                   |
| ------ | -------------------------------------------------------- |
| LBR-01 | FR-14, INV-08, ADR 017; Design Doc § Eventos             |
| LBR-02 | FR-15                                                    |
| LBR-03 | FR-15, FR-16, INV-06                                     |
| LBR-04 | FR-15, FR-16, INV-06                                     |
| LBR-05 | FR-17, INV-07                                            |
| LBR-06 | FR-18; `agent-game-name` AGN-05 (end to end here)        |
| LBR-07 | FR-32, INV-12                                            |
| LBR-08 | FR-32, INV-12                                            |
| LBR-09 | FR-15 (Closed)                                           |
| LBR-10 | INV-04                                                   |
| LBR-11 | NFR-01                                                   |
| LBR-12 | FR-14 … FR-18; NFR-13; prototype (maintainer 2026-11-10) |
| LBR-13 | AGENTS.md rule 10                                        |

## Requirement Traceability

| Requirement ID | Story         | Proof                                                     |
| -------------- | ------------- | --------------------------------------------------------- |
| LBR-01         | Open          | domain unit tests + acceptance `@LBR-01`                  |
| LBR-02         | Awaiting host | acceptance `@LBR-02`                                      |
| LBR-03         | Created       | acceptance `@LBR-03` (headless agent, Party fixture)      |
| LBR-04         | Active        | acceptance `@LBR-04` (two headless agents)                |
| LBR-05         | Expiry        | domain unit tests (3:00 boundary) + acceptance `@LBR-05`  |
| LBR-06         | Next run      | acceptance `@LBR-06` (proves AGN-05 end to end)           |
| LBR-07         | Leave         | domain unit tests (handover order) + acceptance `@LBR-07` |
| LBR-08         | Drop          | acceptance `@LBR-08`                                      |
| LBR-09         | Close         | acceptance `@LBR-09`                                      |
| LBR-10         | One at a time | acceptance `@LBR-10`                                      |
| LBR-11         | Latency       | timing assertions in `@LBR-03`/`@LBR-04` (≤ 2 s)          |
| LBR-12         | Site          | acceptance `@LBR-12` + component tests                    |
| LBR-13         | Telemetry     | unit tests with in-memory exporters                       |

## Decisions (conservative defaults)

- No manual confirmation (the prototype's "confirmou sem agente" is not copied).
- No password: the prototype's password field becomes "No password" and the step says "public game" (ADR 017).
- Drop tolerance 60 s after the agent is offline (itself 45 s without heartbeat) or the site stream closed; configurable.
- An expired room releases its members without penalty (the PRD names no penalty for it).
- A room that never leaves `formed` (the host's agent never fetches the assignment) also expires 3 minutes after it
  opened, so no member is held by a room nobody can create (stricter on fairness; orchestrator, Batch 1 review).
- Only the host opens the next run and closes the room; any member leaves.
