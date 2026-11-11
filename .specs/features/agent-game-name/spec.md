# Agent reads the game name — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Large (see `design.md`) · **Security review**: yes
(live capture and reading of the game window)

## Problem

A room becomes Created and its members confirmed only when an agent reads the room's game name inside the game (FR-16,
INV-06). F0 read a synthetic automap fixture (AD-047, AD-057). The maintainer's screenshots of 2026-11-10 show that D2R
does not draw the game name on the automap; it shows it in the Party panel, masked until the player clicks the eye.
The maintainer chose that the agent reads the name revealed in the Party panel ("Nome revelado no Party"). This feature
makes the released agent do it live, in English first, with the reading driven by a language pack so Portuguese is data
later ("focar inicialmente em inglês… extensível").

## Out of scope

| Item                                                   | Why                                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Chat join and leave messages (rest of FR-27)           | F2 (brief: first version of FR-27 only)                  |
| Room states, expiry, host handover on the API          | `lobby-rooms`                                            |
| Portuguese pack                                        | Later, with Portuguese fixtures (maintainer, 2026-11-10) |
| Capture cascade, fusion of several signals, ≥ 95% rate | F2                                                       |

## Requirements

- **AGN-01** — WHILE capture consent is given, the game runs and the agent holds a room assignment, the agent SHALL look
  for the Party panel in each captured frame (at most one per second) and, when it is open, SHALL read its "Game Name"
  field.
- **AGN-02** — The Party panel and its field SHALL be found by regions relative to the window's client size and by the
  labels of the active language pack, and SHALL be read at the maintainer's 1920×1033 client and at 1920×1080.
- **AGN-03** — WHEN the read name, trimmed and compared without case, equals the assignment's expected game name — with
  `0`, `Ø` and `⊕` read as the letter `o` before the last `-`, and `O`, `o`, `Ø` and `⊕` read as `0` in the number after
  it (D2R draws the letter O as `⊕` and zero as `Ø`) — THEN the agent SHALL post one `GAME_NAME_SEEN`
  observation for that run (with its idempotency key and retry rules of F0); any other name SHALL post nothing.
- **AGN-04** — IF the field shows the masked value (only `x` characters) THEN the agent SHALL post nothing and its window
  SHALL tell the player to open the Party panel and click the eye to show the game name.
- **AGN-05** — WHEN a new run opens with a new expected name THEN the agent SHALL read for that name and post again for
  that run only.
- **AGN-06** — The released agent SHALL do AGN-01 to AGN-05; the F0 fixture-read path stays test-only (AD-057).
- **AGN-07** — The reading SHALL send no frame, crop or read text other than the matching game name in the observation,
  and SHALL run in an `agent.vision.read-game-name` span whose attributes carry only whether it matched.
- **AGN-08** — Every new string in the agent window SHALL come from its translation files (en + pt-BR) (NFR-12).

## Sources

| ID     | Source                                                                               |
| ------ | ------------------------------------------------------------------------------------ |
| AGN-01 | FR-16, FR-27 (first version); maintainer, 2026-11-10 ("Nome revelado no Party")      |
| AGN-02 | NFR-03; maintainer's screenshots (1920×1033); maintainer, 2026-11-10 (language pack) |
| AGN-03 | FR-16, INV-06, INV-09; ADR 017; screenshots (small caps, slashed zero)               |
| AGN-04 | FR-16; screenshot of the masked Party panel                                          |
| AGN-05 | FR-18                                                                                |
| AGN-06 | Brief ("live capture ships a first version in F1"); AD-057                           |
| AGN-07 | ADR 010, NFR-04; AGENTS.md rule 10                                                   |
| AGN-08 | NFR-12; AGENTS.md rule 9                                                             |

## Requirement Traceability

| Requirement ID | Story         | Proof                                                                       |
| -------------- | ------------- | --------------------------------------------------------------------------- |
| AGN-01         | Live reading  | Rust unit tests (core loop with fakes)                                      |
| AGN-02         | Live reading  | Rust unit tests on the regions at 1920×1033 and 1920×1080; Windows OCR test |
| AGN-03         | Matching      | Rust unit tests (domain) + acceptance `@AGN-03` with the headless agent     |
| AGN-04         | Masked name   | Rust unit tests + agent window component test + acceptance `@AGN-04`        |
| AGN-05         | Next run      | Rust unit tests + acceptance `@AGN-05`                                      |
| AGN-06         | Release build | Rust unit test of the app wiring; release build has no `fixture-read`       |
| AGN-07         | Privacy       | Rust unit tests on the observation and the span                             |
| AGN-08         | i18n          | agent window i18n lint                                                      |

## Fixtures

The maintainer's English Party panel screenshots (masked, revealed with and without the tooltip; 1920×1033/1034) are
used after the other players' names in the member list are blurred, since the repository is public. The headless
agent's fixtures are drawn by `xtask` (like F0's) with a room's expected name, so acceptance runs on Linux.

## Decisions

- Glyph mapping per part of the name (ADR 017's `mm{activity}{difficulty}-{n}`): letters before the last `-` (the `o` of
  `cows`, `chaos`), digits after it. The screenshots show `⊕PTI⊕NS`, `L⊕BBY` and `LEVEL 9Ø`.
- The masked value is any run of `x` characters; it is never sent or compared.
- The hint in the agent window shows while the agent holds an assignment and has not matched the current run.
