# Characters read from the screen — Specification

**Phase**: F1, follow-up of `characters` (maintainer, 2026-11-10: "Split characters") · **Size**: Large (design in
`../characters/design.md`, Agent rows) · **Security review**: yes · **Starts**: when the maintainer's screenshots are in
`apps/agent/fixtures/characters/`

## Problem

`characters` ships consent, capture, the contracts, storage and the site, but on a real PC the agent reports `UNKNOWN`
and sends no characters: it has no reading regions, no screen classifier and no card parser, because those can only be
pinned on real screenshots of the English and Portuguese clients. This feature adds them. It closes the brief's exit
criteria 4 (characters from the selection screen, EN and PT) and, with `agent-game-name`, 8.

## Requirements

- **CHR-04** — WHEN a captured frame is the character selection screen, the game in progress, or the game with the
  automap open THEN the agent's next heartbeat SHALL report `CHARACTER_SELECT`, `IN_GAME` or `AUTOMAP_OPEN`, and any
  other frame, or no frame, SHALL report `UNKNOWN`.
- **CHR-06** — WHEN a frame is the character selection screen THEN the agent SHALL read, for each character card visible
  on it, the title line (empty when the character has no title), the name, the level and the class ("Level 88
  Sorceress"), and softcore or hardcore (hardcore names are drawn in red), and SHALL send the cards it read completely to
  the API in one request; a card with any field it could not read SHALL not be sent. Ladder and era are not on the
  screen; the player declares them (`characters` CHR-15).
- **CHR-18** — WHEN a frame shows the "Select Difficulty" popup over the selection screen THEN the agent SHALL read which
  of Normal, Nightmare and Hell are enabled and SHALL send them as the selected character's unlocked difficulties,
  which take precedence over the ones derived from the title.
- **CHR-19** — The reading regions SHALL be defined relative to the game window's client size and SHALL read the
  maintainer's 1920×1033 client (maximized window) as well as 1920×1080; a client size whose aspect ratio is outside
  the supported range SHALL read as `UNKNOWN`.
- **CHR-08** — The reading of CHR-04, CHR-06 and the title table (CHR-07 in `characters`) SHALL give the same result for
  the English and the Portuguese game client on the maintainer's fixtures, at every resolution that has fixtures.
- **CHR-20** — WHILE consent is not given, a character selection screen in front of the agent SHALL leave the site's
  screen `Unknown` and its character list unchanged; WHEN consent is given THEN the next reading SHALL reach the site.

## Sources

| ID     | Source                                                                 |
| ------ | ---------------------------------------------------------------------- |
| CHR-04 | FR-05; Design Doc § Contratos (heartbeat `screen`)                     |
| CHR-06 | FR-02; Design Doc § Modelo de dados (`identity.characters`)            |
| CHR-08 | NFR-12; brief exit criterion 4                                         |
| CHR-20 | NFR-04, NFR-05; `characters` CHR-01 and CHR-02 end to end; ADR 010     |
| CHR-18 | FR-02, FR-09; maintainer's screenshot of 2026-11-10 (difficulty popup) |
| CHR-19 | NFR-03; maintainer's screenshots (1920×1033 client)                    |

## Requirement Traceability

| Requirement ID | Story              | Proof                                                           |
| -------------- | ------------------ | --------------------------------------------------------------- |
| CHR-04         | Screen presence    | Rust unit tests on fixture sidecars + acceptance `@CHR-04`      |
| CHR-06         | Characters read    | Rust unit tests on fixture sidecars + acceptance `@CHR-06`      |
| CHR-08         | Characters read    | Rust tests reading the EN and PT fixtures with Windows OCR (CI) |
| CHR-20         | Consent end to end | acceptance `@CHR-20` with the headless agent                    |
| CHR-18         | Characters read    | Rust unit tests on the popup fixture + acceptance `@CHR-18`     |
| CHR-19         | Characters read    | Rust unit tests at 1920×1033 and 1920×1080                      |

## Fixtures (maintainer, 2026-11-10)

English, 1920×1033 client, received 2026-11-10 (kept out of the repository until other players' names are blurred,
because the repository is public): selection screen with a titled and an untitled character; the "Select Difficulty"
popup; lobby (Join Game, Create Game with the title carousel: LoD, classic and hardcore titles); in game with the
automap closed, open, with chat; the character panel; the Party panel (game name masked).

Still needed: the same screens with the Portuguese client; a hardcore character on the selection screen; the Party
panel with the game name revealed (shared with `agent-game-name`).

## Decisions

- **Ladder and era**: declared by the player (maintainer, 2026-11-10); the screen shows neither.
- The headless agent reads a sidecar `<png>.json` (`{ "<region>": "<text>" }`) instead of OCR on Linux; the Windows CI
  job proves the same regions with Windows OCR on the real images.
