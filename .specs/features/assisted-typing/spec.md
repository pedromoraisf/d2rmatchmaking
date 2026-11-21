# Assisted typing — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: **yes** (first
feature in which the agent sends input to the game; ADR 010, AGENTS.md rule 5) · **Reading modules touched**: none
(rule 14 does not apply; see Decisions)

## Problem

A host creates the game by hand and must type the generated name (`mmbaalh-12`, ADR 017) into the Game Creator. A
mistyped name is a room that never confirms. FR-28 (Should) asks for a hotkey that fills the name for the player,
**without confirming**. Until now the agent has sent nothing to the game (RDY-07: the accept hotkey calls the API
only), and four sensors forbid it: `clippy.toml` (`SendInput`), `deny.toml` (input-synthesis crates), the `windows`
feature allow-list and the source rules. This feature adds the one input the ADR allows ("optional typing helpers that
never confirm") and keeps every other limit.

## Where assisted typing stops (ADR 010)

| Allowed                                                                                                            | Forbidden, whatever the setting or the server says                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| After one press of the player's fill hotkey, send the held room's game name as Unicode character keystrokes        | Any key that confirms or navigates: Enter, NumpadEnter, Tab, Space, Escape, Backspace |
| Only the characters `a–z`, `0–9` and `-`, down and up, one after another, to the foreground window                 | Any virtual key, modifier, shortcut, mouse event, hardware event or clipboard use     |
| Only while the foreground window belongs to a `D2R.exe` process and the last screen read is not the in-game screen | Typing into any other window, or into the game while a game is running (keybinds)     |
| Only the game name the API assigned to the player's held room                                                      | Typing text read from the screen, the chat, a file, or typed by the server on request |
| Stopping at once when focus leaves D2R, the room ends, or the player presses the hotkey again                      | Retrying, repeating, auto-fill without a press, any press the player did not make     |
| Reading the state of the hotkey's own modifier keys, to wait until the player lets them go                         | Reading any other key, any keystroke log, or any hook on input (`SetWindowsHookEx`)   |
| Telling the player "typed — press Enter in the game" and stopping                                                  | Pressing the confirming key, or any action after the last character                   |

The player confirms by pressing Enter (or clicking Create Game) themselves. The agent never does.

## Requirements

- **AST-01** — The agent SHALL register a **fill hotkey** with the OS (`RegisterHotKey` through `global-hotkey`; no
  keyboard hook), default Ctrl+Shift+F, exactly while it holds a room with a game name, and unregister it when the room
  ends or is dropped. The accept hotkey (RDY-07) and the fill hotkey SHALL both be configurable in the agent window.
  The agent SHALL refuse a combination that has no Ctrl or Alt (Shift alone is not enough), uses Enter, NumpadEnter, Tab,
  Space, Escape or Backspace as its key, is a reserved shortcut (Ctrl+C, V, X, A, Z or Alt+F4 on their own, or any
  combination with the Windows key), or equals the other hotkey, keep the previous one and say why. Choices are stored on this PC only and never sent.
- **AST-02** — WHEN the player presses the fill hotkey THEN the agent SHALL type only the game name of the room it
  holds, taken from the assignment the API gave and checked against `mm[a-z0-9]+-[0-9]{1,6}` with at most 32
  characters. A name that does not match, or a press with no held room, SHALL type nothing. The agent SHALL type no
  other text: nothing from the screen, the chat, the clipboard, a file or a server request.
- **AST-03** — WHEN the fill hotkey is pressed THEN the agent SHALL type only if the foreground window belongs to a
  `D2R.exe` process, checked at the press and again before every character. WHEN focus leaves D2R mid-way THEN it SHALL
  stop at once and send no further character.
- **AST-04** — The agent SHALL refuse to type when the last screen it recognised is the in-game screen or the open
  automap, because letters there are game keybinds. An unrecognised frame SHALL NOT clear that memory: it clears only when
  a later frame is recognised as another screen (character select). WHEN the agent has recognised no screen yet, or the
  last one it recognised is character select, typing SHALL be allowed.
- **AST-05** — WHEN the fill hotkey is pressed THEN the agent SHALL wait up to 1 second for the modifier keys of that
  hotkey to be released, and SHALL type nothing if they are still held. It SHALL read the state of those modifier keys
  only.
- **AST-06** — The agent SHALL send each character as a Unicode keystroke (`KEYEVENTF_UNICODE`, virtual key 0), a down
  and an up event, about 15 ms apart. No other kind of event SHALL be sent: no virtual key, no modifier, no mouse, no
  hardware, no clipboard. The only source file that names the input API SHALL be the typing adapter, and the type it
  accepts SHALL be unable to hold a character outside `a–z`, `0–9` and `-`.
- **AST-07** — One press SHALL type once. A press while a fill runs SHALL stop it (and type nothing more); a press less
  than 2 seconds after the last fill ended SHALL be ignored. The fill SHALL stop when the room ends or is dropped
  (ARL-01).
- **AST-08** — WHEN a fill ends THEN the window SHALL say what happened (typed, or the refusal: not a held room, game
  not focused, in-game screen, keys still held, stopped) and, after a full fill, that the player must press Enter in
  the game. The agent SHALL do nothing after the last character.
  WHEN the OS does not let the agent register a hotkey it wants (no hotkey manager, a refused `RegisterHotKey` because
  another program holds the combination, or a failed main-thread dispatch) THEN the window SHALL say so and tell the
  player to choose another combination, until a registration succeeds. Field test of 2026-11-21: the fill hotkey did
  nothing and the window said nothing. The agent SHALL record one `hotkey.unavailable` span event with the slot only.
  A press the agent receives and matches to no registered combination SHALL leave one `hotkey.unmatched` span event.
- **AST-09** — The sensors SHALL stay closed except for one named, minimal exception. The `windows` feature
  `Win32_UI_Input_KeyboardAndMouse` SHALL be added to the allow-list for the typing adapter alone; `SendInput` and
  `GetAsyncKeyState` SHALL be allowed by a scoped `allow` in that file alone; `deny.toml` SHALL gain no crate. A source
  rule SHALL fail when any other file names `SendInput`, `KeyboardAndMouse` or `GetAsyncKeyState`, or when the typing
  adapter names a confirming or navigating virtual key, a modifier, a mouse or hardware input type, or sets a key-event
  flag other than Unicode and key-up. Each rule SHALL have a fixture it rejects. This is the maintainer's decision
  (AGENTS.md rule 4); batch 2 starts only after it.
- **AST-10** — Every fill SHALL record one span event with the outcome (`typed`, `stopped-focus`, `stopped-room`,
  `stopped-press`, `refused-room`, `refused-name`, `refused-focus`, `refused-screen`, `refused-keys`) and no name, text
  or key. Every new string SHALL have English and pt-BR versions (NFR-12), including the site's accept-hotkey hint,
  which SHALL say the accept key is Ctrl+Shift+A by default and can be changed in the agent.

## Sources

| ID     | Source                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| AST-01 | FR-28; Design Doc § hotkeys ("atalhos globais configuráveis"); RDY-07 and ready-check spec ("configurable in F2 with FR-28")    |
| AST-02 | FR-28; ADR 017 (game name pattern); ADR 010 and ADR 011 (server sends data, never commands); INV-08                             |
| AST-03 | Design Doc § hotkeys ("só com o D2R em foco"); brief F2 exit criterion "only while D2R has focus"; ADR 010                      |
| AST-04 | FR-28; ADR 010 (no in-game action); conservative default, see Decisions                                                         |
| AST-05 | FR-28; ADR 010 (no shortcuts reach the game); threat T6                                                                         |
| AST-06 | ADR 010 ("typing helpers that never confirm"); AGENTS.md rule 5; brief exit criterion "source-rule test that no confirm key..." |
| AST-07 | FR-28; ADR 010; FR-18 and LBR-06 (new run, new name); ARL-01                                                                    |
| AST-08 | FR-28 ("sem confirmar"); PRD § Premissas (typing never confirms); lessons (the window reflects state)                           |
| AST-09 | AGENTS.md rules 4 and 5; `clippy.toml`, `deny.toml`, `agent-source-rules.test.mjs` (AGS-21, AGS-22); SECURITY.md                |
| AST-10 | AGENTS.md rules 9 and 10; NFR-12; RDY-08 (the hint on the site)                                                                 |

## Threats each requirement answers (for the security review)

| #   | Threat                                                                                                         | Answered by                      |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| T1  | The agent confirms an in-game action (creates the game, accepts a dialog): a cheat-like automation (ADR 010)   | AST-06, AST-08, AST-09           |
| T2  | The server (or a man in the middle) makes the agent type arbitrary text: chat spam, a slash command, a link    | AST-02 (strict grammar), AST-06  |
| T3  | The text lands in another window: a browser, a password field, a chat client                                   | AST-03 (checked per character)   |
| T4  | Letters typed during a game fire skills, potions or town portal                                                | AST-04                           |
| T5  | A key the OS repeats, or a double press, types twice or keeps typing after the player moved on                 | AST-07                           |
| T6  | The held Ctrl/Shift turn the typed letters into game shortcuts (Ctrl+Shift+letter)                             | AST-05                           |
| T7  | The hotkey registration swallows a combination in other apps all day                                           | AST-01 (registered only in room) |
| T8  | The typing code grows into a keylogger or a general input tool                                                 | AST-05, AST-09 (source rules)    |
| T9  | A sensor is relaxed to make the feature pass and the relaxation stays wider than needed                        | AST-09                           |
| T10 | Typing begins before the game window exists or after it closes; a handle to a dead window sends to another app | AST-03 (foreground pid, each ch) |

## Requirement Traceability

| Requirement ID | Story            | Proof                                                                                                              |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| AST-01         | Choose the key   | Rust unit tests (domain: combination rules; core: registered while a room is held) + window component test         |
| AST-02         | Only the name    | Rust unit tests (domain: the typable name) + acceptance `@AST-02`                                                  |
| AST-03         | D2R has focus    | Rust unit tests (core, fake focus source) + acceptance `@AST-03`                                                   |
| AST-04         | Not during a run | Rust unit tests (core, fake screen) + acceptance `@AST-04`                                                         |
| AST-05         | Keys let go      | Rust unit tests (core, fake key state) + acceptance `@AST-05`                                                      |
| AST-06         | Only characters  | Rust unit tests (events from a fake sink) + `agent-source-rules.test.mjs` + acceptance `@AST-06`                   |
| AST-07         | One press        | Rust unit tests (core) + acceptance `@AST-07`                                                                      |
| AST-08         | Say what         | Rust unit tests (view) + window component test + acceptance `@AST-08`                                              |
| AST-09         | Sensors closed   | `pnpm test:harness` (rules and their rejected fixtures) + `cargo deny --locked check` + `cargo clippy -D warnings` |
| AST-10         | Telemetry, i18n  | Rust unit tests with the in-memory exporter; locales tests; web component test                                     |
| (all)          | The real game    | The maintainer's check on a preview channel installer (DLP-06): fills the real Game Creator, never presses Enter   |

## Decisions (conservative defaults)

- **Unicode keystrokes, not the clipboard and not window messages.** `SendInput` with `KEYEVENTF_UNICODE` sends no
  virtual key, so Enter, Tab and every shortcut are unrepresentable. A clipboard paste would need Ctrl+V and would
  overwrite the player's clipboard; `PostMessageW`/`SendMessageW` stay banned and D2R ignores them.
- **No clearing of the field.** The agent never sends Backspace or Ctrl+A, so it cannot delete anything; the player
  empties the field. Typing into a field that already holds text appends. This is the safer failure.
- **The Game Creator is not recognised.** Recognising it needs a reading-module change on real prints (rule 14, the
  maintainer's screenshots). Instead AST-04 refuses on the screens the agent already knows are a running game. The
  rest (Game Creator, lobby, anything unknown) is allowed because the focus and name rules already bound the harm: the
  text is a short, fixed-grammar name with no confirming key.
- **Fail closed on an unknown screen after a game (security review, fix round 2).** The last recognised screen decides,
  with no time limit: a game whose frames read as unknown still refuses, and a recognised character select clears it.
  An unknown screen with nothing recognised before it, or after character select (the Game Creator is not recognised),
  allows typing, also when capture consent is off (no screen reading at all): typing needs no capture, and refusing
  would make the feature depend on consent it does not use. This replaces the first draft's "an unknown screen allows
  typing" and the 5-second freshness window; it is stricter on safety.
- **The fill hotkey exists only while a room is held**, like the accept hotkey exists only during a ready check (RDY-07).
- **Reading modifier state** (`GetAsyncKeyState` on Ctrl, Shift and Alt only) is the one input _read_ the feature adds.
  It is OS signal, not a hook and not a log; it is on the open questions for the maintainer.
- **Hotkey choices are local**, in the app's config file, never sent to the API. The site cannot know them, so its hint
  names the default and points to the agent (AST-10).
- **Delivery.** The feature needs `delivery-platform` only for the **preview channel installer** (DLP-06): the
  maintainer checks the real Game Creator on it, side by side with the released agent, the updater off. No code of the
  platform is used.
