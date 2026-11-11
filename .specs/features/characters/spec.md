# Characters read by the agent — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Large (see `design.md`) · **Security review**: yes
(first live capture of the game window)

**Split (maintainer, 2026-11-10: "Split characters")**: the screen reading — CHR-04, CHR-06 and CHR-08 — moved to the
follow-up feature `characters-reading`, which waits for the maintainer's screenshots. This feature ships consent,
capture, the screen and characters contracts, storage, the site and the title table. Until the follow-up merges, the
agent reports `UNKNOWN` and sends no characters on a real PC; exit criteria 4 and 8 of the brief stay open.

## Problem

Queues need to know who a player brings: name, class, level, ladder or hardcore, era, and which difficulties the
character has unlocked (INV-02). The PRD wants this read by the agent from the character selection screen, never typed
by the player (FR-02), with the game client in English or Portuguese (NFR-12). F0's agent reads only a synthetic
fixture and reports the screen as `UNKNOWN` (AGS-10, AD-057). F1 ships the first live capture (brief, "Decisions already
taken"), so this feature also adds the player's consent to capture, the capture of the game window, and the screen the
agent is on (FR-05).

## Goals

- A player opens the character selection screen with the agent running and, within seconds, the site lists the
  characters on that screen with every field the queues need.
- The site shows the agent online, the game open and the current screen (FR-05).
- The agent captures nothing before the player consents, and never anything outside the game window (ADR 010, NFR-04).

## Out of scope

| Item                                                        | Why                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Capture cascade, fusion, remote reading regions, ≥ 95% rate | F2 (brief)                                                              |
| Editing a character's fields on the site                    | FR-02 says the agent reads them; a typed value would undermine fairness |
| Removing characters, character history                      | Not in the PRD; a character not seen again stays as last read           |
| Ratings per character                                       | F3 (`ranking`); queues use ADR 018's initial rating until then          |
| Resolutions without fixtures from the maintainer            | The reader refuses a frame size it has no regions for (as F0, AD-047)   |
| The installer's LGPD consent text (NFR-05)                  | F4; this feature adds the in-agent consent the capture depends on       |

## Requirements

- **CHR-01** — WHILE the player has not consented to screen capture, the agent SHALL capture no frame, read nothing and
  report the screen as `UNKNOWN`, and its window SHALL show the consent request with what is captured, what is sent and
  what never leaves the PC.
- **CHR-02** — WHEN the player consents in the agent's window THEN the agent SHALL store the consent on this PC and start
  capturing; WHEN the player withdraws it THEN the agent SHALL stop capturing before its next frame.
- **CHR-03** — WHILE consent is given and the D2R process runs, the agent SHALL capture only the client area of the D2R
  game window, at most once per second, and SHALL keep every frame and crop in memory on this PC only (ADR 010,
  NFR-04).
- **CHR-04** — moved to `characters-reading` (split).
- **CHR-05** — WHEN the agent's heartbeat changes the online state, the game state or the screen THEN the site SHALL show
  the agent online or offline, the game open or closed, and the current screen in words, in the player's language,
  within 2 seconds (FR-05).
- **CHR-06** — moved to `characters-reading` (split).
- **CHR-07** — The agent SHALL derive the unlocked difficulties from the title and the character's mode: no title
  unlocks Normal; the Normal title unlocks Nightmare; the Nightmare title and the Hell title unlock Hell, for the classic,
  expansion, softcore and hardcore titles of either gender.
- **CHR-08** — moved to `characters-reading` (split).
- **CHR-09** — WHEN the API receives characters from a paired agent THEN it SHALL store each one under the agent's account,
  keyed by account and name (case-insensitive), creating it or replacing the read fields (class, level, softcore or
  hardcore, unlocked difficulties) with the newest reading, keeping the ladder and era the player declared, and SHALL
  answer 204; an account holds at most 60 characters.
- **CHR-10** — IF a character in the request breaks the contract (unknown class, level outside 1 to 99, an unknown
  difficulty list, a name outside D2R's rules, more than 24 characters in one request, or more than 60 for the account)
  THEN the API SHALL answer 400 and store none of the request.
- **CHR-11** — WHEN a signed-in player opens the site THEN it SHALL list their characters with name, class, level,
  softcore or hardcore, ladder and era (or "not declared"), unlocked difficulties and the time of the last reading;
  with none, it SHALL tell the player to open the character selection screen with the agent running.
- **CHR-12** — WHEN the API stores characters THEN the player's site SHALL show the new list within 2 seconds without a
  reload.
- **CHR-13** — The agent and the API SHALL keep character names out of logs and span attributes (Design Doc §
  Observabilidade); the reading runs in an `agent.vision.read-characters` span and the request in
  `identity.record-characters`, with counts and the screen as attributes.
- **CHR-15** — WHEN a signed-in player declares, for one of their characters, ladder or non-ladder and the era (classic,
  expansion, Reign of the Warlock) on the site THEN the API SHALL store both and answer 204, and the site SHALL show
  them; a character without both declared SHALL show "Declare ladder and era to queue with this character"
  (maintainer, 2026-11-10: the selection screen shows neither, the player declares them).
- **CHR-16** — IF the character is not the player's THEN the declaration SHALL answer 404 and change nothing; IF the
  request has no session or comes from another origin THEN it SHALL answer 401 or 403.
- **CHR-14** — Every new user-facing string, on the site and in the agent window, SHALL come from the translation files
  in English and pt-BR, and the new controls SHALL be usable by keyboard (NFR-12, NFR-13).

## Sources

| ID     | Source                                                                   |
| ------ | ------------------------------------------------------------------------ |
| CHR-01 | NFR-04, NFR-05; AGENTS.md "Never do: capture without consent"; ADR 010   |
| CHR-02 | NFR-05; ADR 010                                                          |
| CHR-03 | NFR-04; ADR 010; brief "Live capture ships a first version in F1"        |
| CHR-05 | FR-05; NFR-01 (2 s)                                                      |
| CHR-07 | FR-02 ("o título, que indica as dificuldades liberadas"); INV-02         |
| CHR-09 | FR-02; Design Doc § Modelo de domínio (Identity owns `Character`)        |
| CHR-10 | FR-02; NFR-06 (the API validates what the agent sends)                   |
| CHR-11 | FR-02                                                                    |
| CHR-12 | FR-02; NFR-01; ADR 007 (SSE)                                             |
| CHR-13 | AGENTS.md rule 10; Design Doc § Observabilidade (never a character name) |
| CHR-14 | NFR-12, NFR-13; AGENTS.md rule 9                                         |
| CHR-15 | FR-02, FR-08; maintainer, 2026-11-10 ("Jogador declara")                 |
| CHR-16 | NFR-06; ADR 012 (same origin)                                            |

## Requirement Traceability

| Requirement ID | Story                  | Proof                                                                     |
| -------------- | ---------------------- | ------------------------------------------------------------------------- |
| CHR-01         | Consent before capture | Rust unit tests (core) + acceptance `@CHR-01` with the headless agent     |
| CHR-02         | Consent before capture | Rust unit tests (core) + acceptance `@CHR-02`                             |
| CHR-03         | Live capture           | Rust unit tests on the window lookup and crop; Windows CI test            |
| CHR-05         | Screen presence        | acceptance `@CHR-05`                                                      |
| CHR-07         | Characters read        | Rust unit tests of the title table (every title, both genders)            |
| CHR-09         | Characters stored      | acceptance `@CHR-09` + application unit tests                             |
| CHR-10         | Characters stored      | acceptance `@CHR-10` + contract unit tests                                |
| CHR-11         | Characters on the site | acceptance `@CHR-11` + component tests                                    |
| CHR-12         | Characters on the site | acceptance `@CHR-12`                                                      |
| CHR-13         | Telemetry and privacy  | unit tests with in-memory span exporters (TypeScript and Rust)            |
| CHR-14         | Accessibility and i18n | i18n lint (site and agent window) + keyboard steps in `@CHR-11`/`@CHR-15` |
| CHR-15         | Ladder and era         | acceptance `@CHR-15` + component tests                                    |
| CHR-16         | Ladder and era         | acceptance `@CHR-16`                                                      |

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

## Decisions (conservative defaults)

- **Batches**: Batch 1 (consent, capture, contracts, API, site, title table) does not depend on the screenshots and runs
  now; Batch 2 (reading regions, screen classifier, OCR parsing, fixtures) starts when they arrive. The PR opens after
  Batch 2. → `decisions.md → To confirm` (the brief said the feature stops at its spec).
- **Capture method**: `PrintWindow` with `PW_RENDERFULLCONTENT` on the D2R window found by its process id (borderless
  and windowed). Exclusive fullscreen may capture black; the frame then reads as `UNKNOWN`. The cascade is F2.
- **Era**: read from the card if the client shows it. If Batch 2's screenshots show that a card carries no era marker,
  this is escalated with options; until then no default is invented.
- **Unknown fields**: a card with any unread field is not sent (CHR-06); a half-read character never reaches a queue.
- **Character key**: account + name. A name re-used by the same account after deleting a character in-game overwrites
  the old row, which matches what the game itself allows.
- **Consent storage**: a flag in the agent's local settings file, not the OS keychain (it is not a secret).

## Edge cases

- The player scrolls the character list: each reading sends the cards visible then; the API merges by name, so the
  site ends up with every card the player has shown.
- Two agents of one account cannot exist (AD-037), so readings never race across agents.
- A character read at level 80 and later at 79 (a different character with the same name after re-creation) is
  replaced by the newest reading, as CHR-09 says.
- A frame from a resolution with no regions reads nothing and reports `UNKNOWN`, as F0 does for the automap.
- The game window minimized: `PrintWindow` returns nothing usable; the screen is `UNKNOWN` and no card is sent.
