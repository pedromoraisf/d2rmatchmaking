# Game name reading — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (design in `design.md`) · **Security review**:
yes (the agent starts sending two more observation types, with a character name read from the chat)

## Problem

F1 shipped the Party-panel reading of the room's game name (`agent-game-name`, AGN-01 to AGN-08) and proved it on one real
name, "DUEL NK LOCKS", and on `mmbaalh-19`. Field use of agent 0.3.0 and the `ocr-variations` measure left the reading of
the name itself open (F1 post-close items d, e, i and k, and the chat half of FR-27):

- **One generated name proven (item k).** Presence failed in production on the small-caps `B` read as `8`. The prints
  PR #87 adds (`maintainer-party-<gamename>` for `mmbaalh-19`, `mmchaosh-20`, `mmcowsh-38`, `mmtzh-47`,
  `mmheraldsh-56`, `mmpvpn-10` and `mmbaalm-99`) cover every glyph the API generates, but nothing yet measures how often
  each name is read or which glyphs the engine misreads on them.
- **398 of 500 variations of `mmbaalh-19` refused (item e),** mostly `label-not-found-layout-other`. A refusal posts
  nothing, so presence waits; the reasons are not yet sorted into what is fixable.
- **The automap as a second source (item d).** The maintainer suggested reading the name from the top of the screen. The
  PR #87 prints include automap prints with the name. Nothing reads them: `ocr_check.rs` reads the Party and selection
  files only.
- **Normal and nightmare rooms never tested live (item i).** The test match always created hell until #77. The codes
  `n` and `m` are proven on two prints at most (`mmpvpn-10`, `mmbaalm-99`).
- **The chat "joined" and "left" messages (rest of FR-27) are not read at all.** The glossary and the contract carry
  `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN`; no agent code produces them. The brief's exit criterion "Chat" needs
  them, proved on drawn fixtures, the real prints (English and Portuguese) and the field log.

The lesson of F1 applies to every requirement below: prove the reading on the real font with every glyph the server can
generate, never on one fixed name (lessons, "Agent reading"). Reading accuracy is proved by `ocr-real`, `ocr-variations`
and unit tests, not by Gherkin.

## Boundary with `screen-recognition`

`screen-recognition` (SCR-04, SCR-06) makes the Party panel **found** at every supported client height, and it takes PR
#87 in. This feature starts after that merge and reads the name **once the panel is found**: glyphs, vocabulary, the
automap source and the chat. It never changes the area, the boxes or the title and label rules of `find_party` and
`PanelRegion::PartyPanel`. If the variations' reasons show a refusal that is a missed panel and not a missed name, that
reason goes to `screen-recognition` and not into this feature.

## Out of scope

| Item                                                                   | Why                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Finding the Party panel at 1033, 1045, 1056 and 1080 (panel detection) | `screen-recognition` (SCR-04)                                                             |
| The `agent.vision.read-game-name` span fields `panel_open` and `field` | `agent-trust` (AGT-07); this feature adds no attribute to that span                       |
| Matching a chat name against the account's characters                  | `server-name-match` (item g); this feature reads and posts what it read                   |
| What the API does with `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN`     | `lobby-rooms` and `server-name-match`; the types exist in the contract and need no change |
| Remote configuration of the chat words and regions                     | `remote-config`; the words stay in the language packs, regions in `layout.rs`             |
| The capture cascade, exclusive full screen, window-mode field matrix   | `capture-cascade`                                                                         |
| `PLAYER_SLAIN_SEEN` (PvP death message) and round scoring              | F3                                                                                        |
| A new Portuguese pack for panels, popups and cards                     | later; only the chat words of Portuguese enter here, as data, from the prints (GNR-07)    |

## Requirements

- **GNR-01** — WHEN the Party panel is open and the Game Name field shows the room's generated name revealed, THEN the
  agent SHALL read it as that name on every one of the seven generated-name prints (`mmbaalh-19`, `mmchaosh-20`,
  `mmcowsh-38`, `mmtzh-47`, `mmheraldsh-56`, `mmpvpn-10`, `mmbaalm-99`) in `ocr-real`, and in at least 95% of the
  supported `ocr-variations` of those prints. Variations the agent cannot read SHALL be refused.
- **GNR-02** — The agent SHALL never read a room's name as another room's name: on the real prints and their
  variations the count of wrong reads of a game name SHALL be 0, and a unit test SHALL show that no two names the API can
  generate (every activity, every difficulty code, every run number up to 9999) are equal after the glyph rules.
- **GNR-03** — The glyph rules SHALL grow only from reads observed on real prints: each glyph the engine returns for a
  letter or digit of a generated name (`B` as `8`, `⊕` as `0` or `b`, `Ø` as `0`, and the digits of the number) SHALL be
  listed once per part of the name (letters before the last `-`, digits after it), with a unit test for the glyph and one
  for the name it must not match. A glyph is never added from a guess or to make one print pass without an observed read.
- **GNR-04** — The reading SHALL follow the vocabulary of ADR 017, `mm{activity}{difficulty}-{n}`, with the difficulty
  codes `n`, `m` and `h` (normal, nightmare, hell): a read is accepted only when, after the glyph rules, it equals the
  assignment's expected name; the activity list and the codes of the agent SHALL stay equal to the API's (the drift
  test). A read of an `n` room as the code `m`, or of `m` as `n`, SHALL be refused.
- **GNR-05** — Every refusal of a generated-name Party print or variation SHALL be sorted by reason class from the
  `ocr-variations` summary (for example `label-not-found-layout-other`, `field-other-1-edit`). For each class that is a
  rule refusing a readable name, the agent SHALL read it through the smallest change that keeps GNR-02; a class that is
  not (the label is not in the frame) SHALL stay refused and be written in the PR with its count.
- **GNR-06** — WHEN the automap is open and shows the game name, the agent SHALL find the name in a wide area at the
  top of the client by the shape of a generated name (`mm`, letters, `-`, digits), not in one fixed box, and SHALL match it
  with the rule of GNR-03 and GNR-04. A match SHALL post the same `GAME_NAME_SEEN` observation as the Party panel, once
  per run whichever source read it first; any other name SHALL post nothing.
- **GNR-07** — WHEN a chat line in the chat area says that a player joined or left the game THEN the agent SHALL
  classify it by the words of the active language pack (English, and Portuguese added as data) and take the player's
  name from the line. A line with no such words, or a name it cannot read, SHALL be ignored; the agent SHALL never post a
  player's name it did not read.
- **GNR-08** — WHILE the agent holds a room assignment, WHEN GNR-07 reads a new joined or left line, THEN the agent SHALL
  post one `PLAYER_JOINED_SEEN` or `PLAYER_LEFT_SEEN` observation for the run, with the name as read, the F0
  idempotency key and the retry rules of `post_observation`. A line that stays on screen across frames SHALL post once;
  a name that joins, leaves and joins again posts three times. WHILE no assignment is held, nothing SHALL be posted.
- **GNR-09** — The reading of GNR-01 to GNR-06 SHALL hold for the normal (`n`), nightmare (`m`) and hell (`h`) codes: the
  real prints with `n` and `m`, drawn fixtures for every code, and the maintainer's live normal and nightmare rooms
  (brief input 8e) SHALL show the room reaching "Confirmed by the agent".
- **GNR-10** — The agent SHALL send no frame, crop or text other than the matching game name and, for GNR-08, the player
  name read from a joined or left line. No log line, span attribute, metric label or error text SHALL hold a game name
  or a player name. The reading steps SHALL be spans or counters with a fixed vocabulary (the source `party` or `automap`
  or `chat`, the outcome `matched`, `masked`, `other`, `joined`, `left`, `none`), added without changing an assertion of
  the existing span tests. The released agent SHALL stay on the F0 fixture-read exclusion (AGN-06).
- **GNR-11** — The `ocr-real` check SHALL read the automap and chat prints of the encrypted `real-prints.zip` with their
  expected readings, and `ocr-variations` SHALL count them. `ocr-real` SHALL pass on every print of the zip, and
  `ocr-variations` SHALL NOT regress on its ratchet (`ocr.variations.wrong` at or under its ceiling,
  `ocr.variations.correct` at or over its floor). The check's output SHALL carry no game name or player name unless
  `--show-reads` is given, for local runs only.

## Sources

| ID     | Source                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| GNR-01 | FR-27; brief exit criterion 3 (read rate of 95%, 7 prints); F1 post-close item k; `apps/agent/ocr-lab/README.md`      |
| GNR-02 | FR-16, INV-06, INV-09; brief input 2 (zero wrong confirmations); AGN-03; `game_name_match.rs` collision test          |
| GNR-03 | FR-27; lessons ("Agent reading": prove on every glyph the server generates); #76 (`B` read as `8`); AGN-03 decisions  |
| GNR-04 | ADR 017; brief input 7 (the `n`/`m`/`h` codes); #77; `scripts/test/agent-game-name-drift.test.mjs`                    |
| GNR-05 | FR-27; F1 post-close item e (398 of 500 refused); brief exit criterion 3; AGENTS.md rule 14 (ocr-protection)          |
| GNR-06 | FR-27 (reading the name); F1 post-close item d (the automap as a second source); brief input 8b (automap prints)      |
| GNR-07 | FR-27 (the chat's joined and left messages); brief exit criterion "Chat"; brief input 8c; PRD § Sinais limitados      |
| GNR-08 | FR-27; FR-16 (observations); Design Doc § Contratos (`PLAYER_JOINED_SEEN`, `PLAYER_LEFT_SEEN`); `post_observation.rs` |
| GNR-09 | ADR 017; FR-14; F1 post-close item i; brief input 8e (live normal and nightmare rooms)                                |
| GNR-10 | NFR-04; ADR 010; AGENTS.md rules 5 and 10; `docs/engineering/telemetry.md`; AGN-06, AGN-07                            |
| GNR-11 | AGENTS.md rule 14 (ocr-protection); `.quality-baseline.json` `ocr.*`; ADR 026; `apps/agent/ocr-lab/README.md`         |

## Requirement Traceability

| Requirement ID | Story              | Proof                                                                                                       |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| GNR-01         | Name read          | `ocr-real` (7 prints) + `ocr-variations` per print (share correct) in CI; Rust unit tests                   |
| GNR-02         | Never another room | Rust unit tests (collision over the vocabulary) + `ocr-variations` wrong count + acceptance `@GNR-02`       |
| GNR-03         | Misread glyphs     | Rust unit tests per glyph, with the real-print read named in the test comment                               |
| GNR-04         | Vocabulary         | Rust unit tests + `agent-game-name-drift` harness test                                                      |
| GNR-05         | Refusals sorted    | `ocr-variations` summary before and after in the PR; Rust unit tests for each class changed                 |
| GNR-06         | Automap source     | Rust unit tests (domain, core) + drawn fixtures + `ocr-real` on the automap prints + acceptance `@GNR-06`   |
| GNR-07         | Chat lines         | Rust unit tests on drawn fixtures + `ocr-real` on the chat prints (English, Portuguese)                     |
| GNR-08         | Chat observations  | Rust unit tests (core, fake gateway) + acceptance `@GNR-08` with the headless agent                         |
| GNR-09         | Every difficulty   | Rust unit tests + `ocr-real` (`n`, `m` prints) + drawn fixtures + the maintainer's live rooms (field log)   |
| GNR-10         | Privacy, telemetry | source-rule test (no name in a span, log or label) + unit tests with the in-memory exporter + `@NFR-04` run |
| GNR-11         | Real-print proof   | `ocr-real` and `ocr-variations` counts in the pull request (CI, Windows); unit tests of `ocr_check.rs`      |

## Stories

- As a host, I want my room confirmed whichever generated name I created, in normal, nightmare or hell, so that the
  room does not wait on a name the agent could not read (GNR-01, GNR-04, GNR-09).
- As a player, I want the agent never to confirm a room by reading another room's name (GNR-02, GNR-03).
- As a host who left the Party panel closed, I want the agent to read the name from the automap at the top of the
  screen too, so that presence still confirms (GNR-06).
- As a member of a room, I want the agent to tell the room that I joined or left the game, read from the chat, so that
  the room learns who is in (GNR-07, GNR-08).
- As the maintainer, I want every change to the reading proved on the real prints before it merges, and no name or
  character in any log (GNR-05, GNR-10, GNR-11, rule 14).

## Decisions (conservative defaults)

- **Starts after `screen-recognition` batch 1 is merged into `phase/F2`.** T1 merges `origin/phase/F2` with it. This
  feature never touches panel detection, and PR #87 lands through `screen-recognition`, not here.
- **Reading is matching, never free OCR.** The agent knows the room's expected name; a read is accepted only when it
  equals it after the glyph rules. No edit distance is added to the accept rule (`game_name_match.rs` already refuses a
  near name on purpose); `name_diff.rs` stays diagnostic only.
- **The glyph table changes only when a real print shows a read** (GNR-03) and only together with the collision test over
  the whole vocabulary, as `game_name_match.rs` does today.
- **The automap name is found by its shape in a wide area**, with no label word to anchor on (the automap shows the name
  alone). The area and its position come from the maintainer's automap prints, measured on the Mac (counts and boxes only)
  and written into the drawn fixtures, never into a committed capture.
- **Both sources post the same observation.** The Party panel stays the first source; the automap is read only while the
  Party step has not matched the current run, so a run posts once (AGN-05 holds).
- **Chat names are posted as read.** The assignment carries character ids, not names, so the agent cannot filter to
  members, and matching names to members is `server-name-match`. This is the one gray area that adds data to the wire;
  the player name is a character name the player sees in the public game's chat, it is read only while the agent holds
  an assignment, it is never logged, and the API already accepts the two types. To confirm in the phase review; the
  reversal is one line in the core (hold the post until `server-name-match` lands).
- **No new user-facing string in the agent window.** If one is needed, it comes from the translation files (rule 9).
- **Telemetry carries counts and fixed words only** (GNR-10); the existing Party span is left to `agent-trust`.
- **The English chat words are measured on the English prints; the Portuguese words on the Portuguese prints.** A word
  not seen on a print is not added. The Portuguese chat words are data in the pack, not code.
- **Tuning on the maintainer's real prints is the orchestrator's local lane** (brief, "Local lane"): the worker reads
  `ocr-real` and `ocr-variations` from CI, and the geometry of the automap and chat areas comes as numbers in the PR.
