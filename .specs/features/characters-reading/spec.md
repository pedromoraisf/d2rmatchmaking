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
  on it, the name, class, level, softcore or hardcore, ladder or non-ladder, era and title, and SHALL send the cards it
  read completely to the API in one request; a card with any field it could not read SHALL not be sent.
- **CHR-08** — The reading of CHR-04, CHR-06 and the title table (CHR-07 in `characters`) SHALL give the same result for
  the English and the Portuguese game client on the maintainer's fixtures, at every resolution that has fixtures.
- **CHR-15** — WHILE consent is not given, a character selection screen in front of the agent SHALL leave the site's
  screen `Unknown` and its character list unchanged; WHEN consent is given THEN the next reading SHALL reach the site.

## Sources

| ID     | Source                                                             |
| ------ | ------------------------------------------------------------------ |
| CHR-04 | FR-05; Design Doc § Contratos (heartbeat `screen`)                 |
| CHR-06 | FR-02; Design Doc § Modelo de dados (`identity.characters`)        |
| CHR-08 | NFR-12; brief exit criterion 4                                     |
| CHR-15 | NFR-04, NFR-05; `characters` CHR-01 and CHR-02 end to end; ADR 010 |

## Requirement Traceability

| Requirement ID | Story              | Proof                                                           |
| -------------- | ------------------ | --------------------------------------------------------------- |
| CHR-04         | Screen presence    | Rust unit tests on fixture sidecars + acceptance `@CHR-04`      |
| CHR-06         | Characters read    | Rust unit tests on fixture sidecars + acceptance `@CHR-06`      |
| CHR-08         | Characters read    | Rust tests reading the EN and PT fixtures with Windows OCR (CI) |
| CHR-15         | Consent end to end | acceptance `@CHR-15` with the headless agent                    |

## Fixtures needed from the maintainer (brief, "What I need from you" item 1)

PNG screenshots of the whole game window (no other window, no desktop), from the English **and** the Portuguese
client, at **each resolution you play** (1920×1080 at least). File them under `apps/agent/fixtures/characters/` as
`<lang>-<width>x<height>-<shot>.png` and write, next to each, what is on it (`<same name>.txt`: one line per card,
`name | class | level | softcore/hardcore | ladder/non-ladder | era | title or -`).

1. `select-normal` — the character selection screen with a character that has no title (Normal only).
2. `select-titles` — the screen with characters holding a Nightmare title and a Hell title (one softcore, one hardcore
   if you have them).
3. `select-ladder` — the screen with a ladder character and a non-ladder character.
4. `select-eras` — the screen with an expansion character and, if you have them, a classic and a Reign of the Warlock
   character.
5. `select-full` — the screen with as many cards visible as the screen shows (to pin every card position).
6. `in-game` — in a game, automap closed. 7. `automap` — in a game, automap open (shared with `agent-game-name`).
7. `menu` — the main menu or the lobby (a screen that must read as `UNKNOWN`).

## Decisions

- **Era**: read from the card if the client shows it. If the screenshots show no era marker, this is escalated with
  options; no default is invented.
- The headless agent reads a sidecar `<png>.json` (`{ "<region>": "<text>" }`) instead of OCR on Linux; the Windows CI
  job proves the same regions with Windows OCR on the real images.
