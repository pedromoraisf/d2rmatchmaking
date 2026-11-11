# Ready check — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: yes (a new agent
route and a global hotkey in the agent)

## Problem

`queues` sends a formed group straight to a room. The PRD wants every member to confirm first, within 1 minute, on the
site or by the agent's hotkey (FR-12). Declining carries no penalty for now; not answering gives a 5-minute wait; the
members who accepted return to the top of the queue (FR-13, INV-05, maintainer 2026-11-10). The agent hotkey calls the
API and never sends input to the game (brief notes, ADR 010).

## Requirements

- **RDY-01** — WHEN `queues` forms a group THEN Matchmaking SHALL open a ready check for its members with a deadline 60
  seconds later, instead of publishing `MatchFormed`, and SHALL tell each member's site and agent (`ready_check.started`
  with the deadline and the members' class and level, no names of other players).
- **RDY-02** — WHEN a member accepts on the site or with the agent's hotkey before the deadline THEN the API SHALL record
  it and tell every member's site who has accepted (by position, not name).
- **RDY-03** — WHEN every member has accepted THEN Matchmaking SHALL publish `MatchFormed` with the group (join order and
  host as `queues` decided) and close the check as accepted (`ready_check.resolved`).
- **RDY-04** — WHEN a member declines THEN the check SHALL end at once as failed, the decliner SHALL get no penalty and
  leave the queue, and every member who had accepted SHALL return to the queue ahead of every ticket that joined after
  theirs did originally.
- **RDY-05** — WHEN the deadline passes with members who did not answer THEN the check SHALL end as failed, each
  non-answering member SHALL be unable to queue for 5 minutes (refusal `ready-check-penalty` with the time left), and
  the members who accepted SHALL return to the queue as in RDY-04; a member who neither accepted nor answered (including
  one whose agent or site dropped) counts as not answering.
- **RDY-06** — IF a member answers after the check ended, twice, or for a check they are not in THEN the API SHALL answer
  409 or 404 and change nothing.
- **RDY-07** — The agent SHALL register one global hotkey (Ctrl+Shift+A, shown in its window and on the site) that, only
  while its account has an open ready check, calls the accept route with the agent token; it SHALL send no keystroke,
  click or other input to the game or any window. The accept route SHALL apply the minimum agent version (426, ADR 011) to the agent like every agent route.
- **RDY-08** — The site SHALL show the ready check as the prototype's overlay (countdown ring, members' marks, Accept and
  Decline, the hotkey hint), with focus moved to Accept, usable by keyboard, and SHALL state that declining has no
  penalty and that not answering gives a 5-minute wait.
- **RDY-09** — The penalties SHALL persist across an API restart (`matchmaking.penalties`); open checks live in memory.
- **RDY-10** — Matchmaking SHALL record spans for opening, answering and resolving a check, and a metric of checks by
  outcome (accepted, declined, timed out), with no names; every new string in en and pt-BR (NFR-12).
- **RDY-11** — WHEN a site loads or its stream reopens, or an agent's stream reconnects, THEN it SHALL read the
  account's open ready check (`GET /v1/ready-checks/me`, session or agent token; 204 when none) and show the overlay or
  arm the hotkey accordingly; the agent SHALL disarm the hotkey at the check's deadline even if no resolution arrives.

## Sources

| ID     | Source                                                                |
| ------ | --------------------------------------------------------------------- |
| RDY-01 | FR-12; Design Doc § Contratos (`ready_check.started`)                 |
| RDY-02 | FR-12                                                                 |
| RDY-03 | FR-12; Design Doc § Eventos (`MatchFormed`)                           |
| RDY-04 | FR-13, INV-05; maintainer 2026-11-10 ("Hoje não deve acontecer nada") |
| RDY-05 | FR-13, INV-05; brief ("Not answering keeps the 5-minute wait")        |
| RDY-06 | NFR-06                                                                |
| RDY-07 | FR-12; ADR 010; brief notes (hotkey calls the API, no input)          |
| RDY-08 | FR-12; NFR-13; prototype (maintainer 2026-11-10)                      |
| RDY-09 | Design Doc § Modelo de dados (`matchmaking.penalties`)                |
| RDY-10 | AGENTS.md rules 9, 10                                                 |
| RDY-11 | FR-12; ADR 007 (stream reconnects)                                    |

## Requirement Traceability

| Requirement ID | Story     | Proof                                                    |
| -------------- | --------- | -------------------------------------------------------- |
| RDY-01         | Open      | acceptance `@RDY-01` + domain unit tests                 |
| RDY-02         | Answer    | acceptance `@RDY-02`                                     |
| RDY-03         | Accepted  | acceptance `@RDY-03`                                     |
| RDY-04         | Declined  | acceptance `@RDY-04` + domain unit tests (queue order)   |
| RDY-05         | Timed out | acceptance `@RDY-05` + domain unit tests (60 s boundary) |
| RDY-06         | Guards    | acceptance `@RDY-06`                                     |
| RDY-07         | Hotkey    | Rust unit tests (core) + acceptance `@RDY-07` (headless) |
| RDY-08         | Site      | acceptance `@RDY-08` + component tests                   |
| RDY-09         | Penalties | integration test (restart keeps a penalty)               |
| RDY-10         | Telemetry | unit tests with in-memory exporters; i18n lint           |
| RDY-11         | Answer    | route integration test + component and Rust unit tests   |

## Decisions (conservative defaults)

- Accepted members keep their original join time, so they return ahead of every later ticket (the prototype's "you are
  back at the top of the queue").
- The prototype's "declining gives 5 minutes" is not copied: declining has no penalty (maintainer, 2026-11-10).
- Other players' names are not shown during the check; positions and class marks only, as in the prototype.
- The hotkey is fixed in F1 (configurable hotkeys are F2 with FR-28).
