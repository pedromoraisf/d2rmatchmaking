# Game name reading — Design

Short. The agent keeps its hexagonal shape (ADR 027): `adapters → core → domain`. Nothing here adds a crate or a route.
No contract change, and no chat observation: posting `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN` (GNR-08) moved to
`server-name-match`. Relies on ADR 010 (read-only agent), 017 (game names), 026 (mutation scope), 027, and on AGENTS.md rule
14 (the reading modules).

## Principle

The agent never reads a name blind. It holds the room's expected name and decides whether the screen shows **that**
name: the read is accepted only when it equals the expected name after a glyph table (`game_name_match.rs`), per part of
`mm{activity}{difficulty}-{n}`. Everything in this feature either helps the engine see the name (where to look, which
variant) or makes the table honest about what the engine returns. It never loosens the accept rule (no edit distance).
The chat is the other direction: the agent has no expected line, so it classifies by words, locally, and posts nothing.

## Modules and layers

| Layer  | File (`apps/agent/src-tauri/…`)                          | Change                                                                                                                     |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| domain | `domain/src/game_name_match.rs` (reading module)         | glyph table grows from observed reads only (GNR-03); collision test over the whole vocabulary stays and grows with it      |
| domain | `domain/src/layout.rs` (reading module)                  | `ScreenRegion::AutomapName` (a wide area at the top) and `ScreenRegion::ChatArea` (GNR-06, GNR-07); no Party box changes   |
| domain | `domain/src/anchors.rs` (reading module)                 | `find_name_line` (a line shaped like a generated name, in a wide area) and `chat_lines` (lines of the chat area)           |
| domain | `domain/src/chat.rs` (new)                               | `ChatEvent { Joined, Left }`, `classify(pack, line)`, `ChatTracker` (a line present in the last frame is not new). Pure    |
| domain | `domain/src/language.rs` (reading module), `lang/*.json` | chat words as data: `joinedGame`, `leftGame`; English first, Portuguese from its prints                                    |
| core   | `core/src/party.rs` (reading module)                     | the Party step stays; it exposes that it matched, so the automap step skips a run already confirmed                        |
| core   | `core/src/automap_name.rs` (new)                         | reads the automap's name line while the Party step has not matched the run; matches and posts through `post_observation`   |
| core   | `core/src/chat_step.rs` (new)                            | reads the chat area, tracks new lines, counts them (`joined`, `left`); posts nothing                                       |
| core   | `core/src/watch_screen.rs`                               | calls the Party step, then the automap step, then the chat step on each captured frame (at most one per second, as AGN-01) |
| tests  | `src/ocr_check.rs` (app crate)                           | reads the automap and chat prints with their expected readings (GNR-11); the verdicts print no name without `--show-reads` |
| xtask  | `xtask/src/*_fixture.rs`                                 | draws `automap-name` and `chat` fixtures (English and Portuguese lines) with sidecars of lines that have boxes             |
| tests  | `tests/acceptance/steps/game-name-reading.steps.ts`      | steps over the headless agent and the drawn fixtures, reusing `agent-game-name` steps                                      |

The new modules `domain/src/chat.rs`, `core/src/automap_name.rs` and `core/src/chat_step.rs` decide what is read and
posted, so they join `scripts/agent/reading-modules.json`. That edit touches a sensor file, so the gate asks the
maintainer (tasks.md, "Gate prompts"). Until it lands, each of them is written as a thin file whose logic is pure and
unit-tested, and that is reviewed as a reading module.

## Ports

No new port. `TextReader` already has `read`, `read_lines` and `read_line_variants`; the steps only choose the area. The
domain stays pure (no clock, no randomness, no I/O): `ChatTracker::next(&mut self, lines) -> Vec<ChatEvent>` takes the
lines of one frame. Frame time and idempotency keys come from the core (`Clock`, `IdGenerator`).

## The automap source (GNR-06)

The automap shows the game name alone, with no label word to anchor on, so the area is found by shape: among the lines of
a wide area at the top of the client, the first whose normalised read parses as `mm` + letters + `-` + digits is the
candidate, then it goes through the same match as the Party field. The area is a band (the fixed box is never the only
place), its geometry measured on the maintainer's automap prints by an `xtask` geometry command on the Mac (counts and
pixel boxes, never a pixel written to the repository). The automap step runs only when the Party step has not matched
the current run, so one run posts once whichever source reads it first.

## The chat (GNR-07)

The chat area is a wide area at the left bottom of the client (position measured on the chat prints, as above). Its
lines are classified by the pack's words (`joinedGame`, `leftGame`), with the name taken as the text before them. A line
the classifier cannot parse is ignored; a blank name is ignored. D2R fades chat lines after a few
seconds, so the tracker treats a line as new when it was not among the previous frame's lines; a name that joins, leaves
and joins again is three events. The events stay in the process: they are counted with a fixed word and posted by nobody;
`server-name-match` will consume them when it owns the contract and the matching.

## Data

- The vocabulary of ADR 017 lives once in `game_name_match.rs` (`AGENT_ACTIVITIES`, `AGENT_DIFFICULTY_CODES`); the
  harness drift test `scripts/test/agent-game-name-drift.test.mjs` keeps it equal to the API's.
- Chat words per language are data in the packs (`resources/lang/*.json`), as every other word of the reading.
- No persistence. Nothing about a frame or a line of text is stored or sent; the observation carries the matching game
  name.

## Fixtures

Drawn by `xtask` (`draw-fixture automap-name`, `draw-fixture chat`) with the repository's open font and committed under
`apps/agent/fixtures/`: every difficulty code, the generated activities, English and Portuguese chat lines, a line
repeated across frames, and a near name. No capture is ever committed; the maintainer's real prints stay in the encrypted
`real-prints.zip` and are read from a local path (`ocr-lab`) or by CI.

## Proof strategy

- **Unit tests** in each module, the pinning tests first (rule 14): today's matches and refusals at the point about to
  change, with values named in the code as measured.
- **Real prints in CI** (Windows): `ocr-real` reads the seven generated-name Party prints and, from T6, the automap and
  chat prints; `ocr-variations` counts them in its totals. The PR shows the before and after counts per print and reason
  class. A red `ocr-real` or a worse count is a failed gate.
- **Field**: the maintainer's live normal and nightmare rooms, and the field log (brief exit criterion 3).

## Telemetry (rule 10, GNR-10)

Spans and counters with a fixed vocabulary only; no name, no text, no coordinates.

| Name                             | Kind    | Attributes                                                              |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| `agent.vision.read-automap-name` | span    | `matched` (bool)                                                        |
| `agent.vision.read-chat`         | span    | `events` (count of new joined and left lines)                           |
| `agent.vision.name_reads`        | counter | `source` = `party`, `automap`; `outcome` = `matched`, `masked`, `other` |
| `agent.vision.chat_events`       | counter | `kind` = `joined`, `left`                                               |

The existing `agent.vision.read-game-name` span is `agent-trust`'s (AGT-07); this feature adds no attribute to it. A
source-rule test refuses a read text or a name in a span attribute or a metric label of the new code.

## Security

The agent still reads only the game window's pixels (ADR 010). No new data goes on the wire: a character name read from a
chat line stays in the process. The security reviewer reads: that no frame or crop leaves, that no chat name is sent,
logged or put in a span or label.

## ADRs

ADR 010, 017, 026 (no mutation in a task gate), 027 and AGENTS.md rule 14. No new ADR: a choice against one of them is an
escalation.
