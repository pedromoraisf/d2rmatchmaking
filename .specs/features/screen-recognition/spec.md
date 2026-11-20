# Screen recognition — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (design in `design.md`) · **Security review**:
no (reading logic and tests only; no new route, no new capture, no input to the game)

## Problem

The agent reports the player's current screen (FR-05) and registers characters from the selection screen (FR-02). Field
use of agent 0.3.0 and the `ocr-variations` measure showed that its recognition breaks outside the one client it was
tuned on:

- **In game, "Screen: not recognised" (item a).** The in-game marker is the "Life:" label in one fixed box. D2R does not
  scale its HUD linearly between a window (1920×1056) and full screen (1920×1080), so the box misses in both. The site
  then shows "Screen: Unknown". Work in progress exists on `origin/feat/agent-ingame-band-search` (two commits).
- **The Party panel is missed at another client height.** The PR #87 prints add seven generated-game-name prints. Six of
  them are 1920×1045, against 1920×1033 for the prints that pass, and `ocr-real` fails on them with "the panel is not
  open: title found: false, label found: false". The Party panel is also found inside a fixed area, so this is the same
  class of failure as item a.
- **Selection screens and popups are not recognised (item f).** In the `ocr-variations` of PR #71, 176 popup frames read
  no card at all and 104 screens were not recognised. They predate this record.
- **No field proof per window mode (NFR-03).** The matrix (windowed, borderless, full screen; legacy graphics; low and
  high brightness) has not been run on the 0.3.0 agent. Items that need it wait for the maintainer (brief input 8d).

The lesson of F1 applies: search for the words in a wide area, never in one fixed box. Reading accuracy is proved on the
real prints (`ocr-real`, `ocr-variations`) and by unit tests, not by Gherkin.

## Requirements

- **SCR-01** — WHEN the game is in progress THEN the agent SHALL recognise the in-game screen by finding the "Life:" or
  "Mana:" word in a full-width band along the bottom of the client, in a window and in full screen, whatever the
  client's size within the supported range. The band SHALL be read only when the frame is not the character list.
- **SCR-02** — WHILE the in-game label was found in an earlier frame of the same client size THEN the agent SHALL read
  only a small box around where it was found, and SHALL search the band again when that box misses or the client size
  changes (search, then track), so a steady session costs a box and not the band.
- **SCR-03** — WHEN the automap is open THEN the agent SHALL recognise it by finding the "Difficulty:" word in a wide
  area of the client, not in one fixed box, in every mode of SCR-01, with the same search-then-track rule.
- **SCR-04** — WHEN a frame shows the Party panel THEN the agent SHALL find its title and its "Game Name" label by their
  words in an area wide enough for every supported client height, including 1920×1033, 1920×1045 and 1920×1080, in the
  English and in the Brazilian Portuguese (pt-BR) game client (the 1045 prints are pt-BR: "Grupo", "Nome", "Senha"). The
  agent SHALL NOT read the room's name as another room's (the zero-wrong rule of the brief stays).
- **SCR-05** — WHEN a frame shows the character selection screen THEN the agent SHALL recognise it in at least 95% of
  its `ocr-variations` (supported sizes). WHEN a frame shows the "Select Difficulty" popup THEN the agent SHALL read its
  options and the selected card in at least 95% of its `ocr-variations`. A frame it cannot read SHALL be refused, never
  read as another screen or another character.
- **SCR-06** — The `ocr-real` check SHALL pass on all twelve prints of the encrypted `real-prints.zip` (five known
  frames and seven generated-name Party frames, once PR #87's zip is in), and `ocr-variations` SHALL NOT regress on its
  ratchet: `ocr.variations.wrong` at or under its ceiling and `ocr.variations.correct` at or over its floor, with the
  floor and ceiling moved in the direction of improvement only by the maintainer's decision (AGENTS.md rule 4).
- **SCR-07** — The agent SHALL work, with no game configuration, in windowed, borderless and full-screen modes, with
  legacy graphics and at low and high brightness: the recognition of SCR-01 to SCR-05 SHALL hold on a drawn fixture for
  each mode, and the maintainer's field matrix SHALL confirm it on a real PC.
- **SCR-08** — The screen the agent recognises SHALL reach the site in its heartbeat as it does today, and an unrecognised
  frame, no frame, or a client size outside the supported range SHALL read as `UNKNOWN`. WHILE consent is not given THEN
  nothing SHALL be read (CHR-20 stays).
- **SCR-09** — The frame and the text SHALL never leave the process, and the agent SHALL read only the game window's
  pixels and OS signals (ADR 010). Each recognition step SHALL be a span or a counter with fixed vocabulary and no
  read text: the screen, the search or track mode, the area size class and the outcome (found, missed, refused).

## Sources

| ID     | Source                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| SCR-01 | FR-05; NFR-03; F1 post-close item a; lessons ("Agent reading": wide-area word search, window vs full)      |
| SCR-02 | NFR-02 (CPU); F1 post-close item a (`hud_track` on `feat/agent-ingame-band-search`)                        |
| SCR-03 | FR-05; NFR-03; lessons ("Agent reading": a fixed box breaks across window and full screen)                 |
| SCR-04 | FR-05; NFR-03; post-close item a; the 1920×1045 failures of PR #87's prints (coordinator, 2026-11-20)      |
| SCR-05 | FR-02 (hardening); F1 post-close item f; PR #71 numbers (176 popups, 104 screens); brief exit criterion 4  |
| SCR-06 | brief exit criteria 3 and 4; AGENTS.md rule 14 (ocr-protection); ADR 026; `.quality-baseline.json` `ocr.*` |
| SCR-07 | NFR-03; brief exit criterion 6; F1 post-close item h; brief input 8d                                       |
| SCR-08 | FR-05; CHR-04, CHR-19, CHR-20; Design Doc § Contratos (heartbeat `screen`)                                 |
| SCR-09 | NFR-04; ADR 010; ADR 027 (domain reads no I/O); AGENTS.md rules 5 and 10; `docs/engineering/telemetry.md`  |

## Requirement Traceability

| Requirement ID | Story               | Proof                                                                                                  |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| SCR-01         | In-game screen      | Rust unit tests (domain, core) + drawn fixtures + acceptance `@SCR-01`; field matrix                   |
| SCR-02         | Cheap steady reads  | Rust unit tests (`hud_track`, core) asking which areas were read                                       |
| SCR-03         | Automap screen      | Rust unit tests + drawn fixtures + acceptance `@SCR-03`; field matrix                                  |
| SCR-04         | Party panel found   | Rust unit tests at three heights + `ocr-real` on the twelve prints + `ocr-variations` ratchet          |
| SCR-05         | Selection and popup | `ocr-variations` ratchet (supported totals) + unit tests; named in tasks.md                            |
| SCR-06         | Real-print proof    | `ocr-real` (12 prints) and `ocr-variations` counts in the PR; CI                                       |
| SCR-07         | Every mode          | Drawn fixtures per mode (unit tests, acceptance `@SCR-07`) + the maintainer's field matrix             |
| SCR-08         | Heartbeat screen    | acceptance `@SCR-08` with the headless agent                                                           |
| SCR-09         | Privacy, telemetry  | source-rule test (no frame or text in a span) + unit tests with the in-memory exporter + `@NFR-04` run |

## Stories

- As a player, I want the site to say "In game" when I am in a game, in a window or in full screen, so that I trust that
  the agent sees me (SCR-01, SCR-03, SCR-07, SCR-08).
- As a player, I want the agent to cost almost no CPU while I play, so that my FPS does not drop (SCR-02).
- As a host, I want my room's name read from the Party panel on my client size, so that presence confirms (SCR-04, SCR-06).
- As a player, I want my characters registered from the selection screen and the popup, and never a wrong one, so that I
  queue with the right character (SCR-05).
- As the maintainer, I want every change to the reading proved on the real prints before it merges (SCR-06, rule 14).

## Decisions (conservative defaults)

- **Resume from `feat/agent-ingame-band-search`, the whole of it** (domain `hud_track`, `HudBand`, `find_hud`, the `Mana:`
  word and the core reader's tracking). Its two commits have unit tests and only add code beside the fixed "Life:" box.
  The fixed box stays as the first, cheapest check; the band is the fallback. The work-in-progress commit is rebased
  onto `phase/F2` by cherry-picking `4e190ad` and `9d6f963` and then reviewed line by line against rule 14 before it goes on.
- **The automap marker and the Party panel get the same search-by-words treatment** as the HUD (SCR-03, SCR-04); they
  are the same failure. If the field matrix shows the automap box is fine in every mode, SCR-03 stays as a fallback only.
- **A window or full-screen client of any size inside the supported aspect range reads**; a client outside it reads
  `UNKNOWN` (CHR-19). No new sizes are added.
- **PR #87 is taken into this feature** (coordinator, 2026-11-20): T1 merges `origin/chore/F2-real-prints-generated-names`
  in, so the twelve-print proof is the feature's exit. #87 does not merge on its own.
- **Character names ("O" read as g/e/b, 43 wrong reads)** are not fixed here: that is `server-name-match`. SCR-05 counts
  the selection screen and popup recognition, not the spelling of a name.
- **Game-name reading items d, e, i and k** belong to `game-name-reading`. SCR-04 concerns only that the panel is found.
- **Window-mode, brightness and legacy-graphics tasks wait for the maintainer's field matrix** (brief input 8d); the
  drawn fixtures and unit tests do not wait.
- **Telemetry** carries counts and fixed words only (SCR-09); no new attribute holds read text.
- **Exclusive full screen** is the capture cascade's (`capture-cascade`); this feature reads the frames it is given.
