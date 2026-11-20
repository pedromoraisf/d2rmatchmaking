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

| Requirement ID | Story           | Proof                                                      |
| -------------- | --------------- | ---------------------------------------------------------- |
| ARL-01         | Room ends       | Rust unit tests (core, adapters) + acceptance `@ARL-01`    |
| ARL-02         | Reconnect       | Rust unit tests (core)                                     |
| ARL-03         | Confirmed       | Rust unit tests (view) + window component test + `@ARL-03` |
| ARL-04         | Next run        | Rust unit tests (view)                                     |
| ARL-05         | Dismiss         | component test + acceptance `@ARL-05`                      |
| ARL-06         | Presence        | component/unit test + acceptance `@ARL-06`                 |
| ARL-07         | Telemetry, i18n | Rust unit tests with the in-memory exporter; locales tests |

## Decisions (conservative defaults)

- "Presence confirmed" follows the API's acceptance of the observation, not the agent's own match. A refused or failed
  post keeps "waiting for the game".
- The site remembers a dismissal in `localStorage`, keyed by room id, with no server state and no new route.
- ARL-06 does not change the 45-second offline rule (CHR-05). It only makes the site read presence again after a
  reconnect.
