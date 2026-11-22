# Agent room lifecycle — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: no (no new route, no
capture change; the agent only reads one more stream event)

## Problem

Field use of agent 0.3.0 (F1 post-close, items b and c) showed three mismatches between what happened and what the
windows say:

- After a room expired or closed, the agent kept the assignment. Its window kept "waiting for the game", and the Party
  step kept looking for a room that no longer exists. `adapters/src/http/sse.rs` ignores the room's stage event.
- After the agent confirmed presence, its window still said "waiting for the game". The maintainer read that as broken
  presence (lessons: "a diagnostic line in the agent window must reflect state changes").
- On the site, "Dismiss" on an ended room is lost on reload (#80 review). A worker also saw "agent online · game open"
  linger well over a minute after the agent stopped (#80).

Work already started: branch `fix/agent-drop-expired-room` (commit 6e67830, pushed 2026-11-20) parses the room's end in
the stream and clears the held assignment, with two unit tests.

## Requirements

- **ARL-01** — WHEN the agent's stream reports that the room it holds moved to `expired` or `closed` THEN the agent
  SHALL drop the assignment, stop the Party step for that room and remove the room line from its window. An end for
  another room SHALL change nothing.
- **ARL-02** — WHEN the agent's stream reconnects or the agent starts THEN it SHALL read its current assignment again,
  and SHALL drop a held room the API no longer assigns (a room that ended while the stream was down).
- **ARL-03** — WHEN the API accepts the agent's observation for the held run (2xx) THEN the window SHALL show the room
  line as "presence confirmed" with the game name, until the run changes or the room ends.
- **ARL-04** — WHEN a new run of the held room starts (LBR-06) THEN the window SHALL return to "waiting for the game" with
  the new game name.
- **ARL-05** — WHEN a player dismisses an ended room on the site THEN the site SHALL keep that room dismissed after a
  reload, by remembering the room id in the browser only. A different room SHALL show normally.
- **ARL-06** — WHEN the site's stream reconnects THEN the site SHALL read the agent's presence again. The site SHALL
  never show an agent online more than 60 seconds after its last heartbeat (the API marks it offline at 45 seconds).
- **ARL-07** — The agent SHALL record each dropped assignment and each confirmed run as span events, with the reason
  (`expired`, `closed`, `not-assigned`) and no names. Every new string SHALL have English and pt-BR versions (NFR-12).

- **ARL-08** — WHILE the agent holds a run whose presence was confirmed, WHEN the Party panel shows a game name that is
  **not** the held run's name on two looks in a row, and that name is not a near-miss of it (an edit distance above 2
  from the held name, so a misread of the right name never counts), THEN the agent SHALL show "You are in another game
  (not {{gameName}})" in its window. It SHALL never show, send or log the other game's name. When it reads the held
  name again it SHALL return to "presence confirmed".
- **ARL-09** — On the change of ARL-08 the agent SHALL post one `OTHER_GAME_SEEN` observation for the held run, with no
  value (contract first: a new observation kind with no `value`, ADR 020), and on the return one `GAME_NAME_SEEN` as
  today. At most one post per change.
- **ARL-10** — WHEN the API accepts `OTHER_GAME_SEEN` from a member's agent for the current run THEN that member's
  presence SHALL become **elsewhere** and the room's stream SHALL tell the site; a later accepted `GAME_NAME_SEEN` for
  the current run SHALL make it **confirmed** again. The room's stage SHALL NOT change (no transition, INV-06
  untouched): the game lives on while anyone is in it, and the room still expires or closes as today.
- **ARL-11** — The site SHALL show "In another game" / "Em outro jogo" for a member whose presence is elsewhere, in
  place of "Confirmed by the agent", to every member of the room. New strings in English and pt-BR (NFR-12); span
  events with no names (ARL-07).

## Sources

| ID     | Source                                                                        |
| ------ | ----------------------------------------------------------------------------- |
| ARL-01 | FR-17, LBR-05, LBR-09; F1 post-close item b                                   |
| ARL-02 | FR-16; ADR 007 (stream reconnects)                                            |
| ARL-03 | FR-16; F1 post-close item c; lessons (diagnostic line reflects state)         |
| ARL-04 | FR-18, LBR-06                                                                 |
| ARL-05 | FR-17; #80 review                                                             |
| ARL-06 | FR-05; #80 worker note; `agents/domain/presence.ts` (`OFFLINE_AFTER_MS` 45 s) |
| ARL-07 | AGENTS.md rules 9 and 10                                                      |

## Requirement Traceability

| Requirement ID | Story           | Proof                                                                            |
| -------------- | --------------- | -------------------------------------------------------------------------------- |
| ARL-01         | Room ends       | Rust unit tests (core, adapters) + acceptance `@ARL-01`                          |
| ARL-02         | Reconnect       | Rust unit tests (core)                                                           |
| ARL-03         | Confirmed       | Rust unit tests (view) + window component test + `@ARL-03`                       |
| ARL-04         | Next run        | Rust unit tests (view)                                                           |
| ARL-05         | Dismiss         | component test + acceptance `@ARL-05`                                            |
| ARL-06         | Presence        | component/unit test + acceptance `@ARL-06`                                       |
| ARL-07         | Telemetry, i18n | Rust unit tests with the in-memory exporter; locales tests                       |
| ARL-08         | Another game    | Rust unit tests (core: two looks, near-miss rule, return) + acceptance `@ARL-08` |
| ARL-09         | Tell the API    | Rust unit tests (core) + contract tests + acceptance `@ARL-09`                   |
| ARL-10         | Elsewhere       | domain unit tests + API integration test + acceptance `@ARL-10`                  |
| ARL-11         | Site shows it   | web component test + acceptance `@ARL-11`                                        |

## Decisions (conservative defaults)

- "Presence confirmed" follows the API's acceptance of the observation, not the agent's own match. A refused or failed
  post keeps "waiting for the game".
- The site remembers a dismissal in `localStorage`, keyed by room id, with no server state and no new route.
- ARL-06 does not change the 45-second offline rule (CHR-05). It only makes the site read presence again after a
  reconnect.
