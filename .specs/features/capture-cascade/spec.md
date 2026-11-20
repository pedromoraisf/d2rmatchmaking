# Capture cascade — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (design in `design.md`) · **Security review**:
yes (the feature adds new capture APIs to the agent: ADR 010, NFR-04, AGENTS.md rule 5)

## Problem

Today the agent has one way to see the game: `PrintWindow` of the game window (`PW_CLIENTONLY | PW_RENDERFULLCONTENT`,
`apps/agent/src-tauri/src/adapters/window_capture.rs`). The Design Doc and ADR 010 promise a **cascade** ("window, then
monitor") and list "exclusive full screen returning a black frame" as a risk to validate in F2. What is missing:

- **No second method.** When `PrintWindow` returns a black or uniform frame (some renderers and full-screen modes do),
  the agent reads a blank image and the site shows "Screen: Unknown". The agent already measures this: `frame_content`
  marks a frame `blank` and the window diagnostics show it (the Windows incident of 2026-11-19), but nothing acts on it.
- **A blank frame is still read.** `watch_screen::tick` runs the whole OCR reader on every captured frame, blank or not,
  which spends CPU for a result that cannot be right (NFR-02).
- **The heartbeat says nothing true about the capture.** `capture` is the constant `{ "method": "none", "readRate": 0 }`
  (`adapters/src/http/translate.rs`), so the maintainer cannot tell from the server which method worked on a PC.
- **No field proof per mode (NFR-03).** The matrix (windowed, borderless, full screen; legacy graphics; low and high
  brightness) has not been run on the 0.3.0 agent (F1 post-close item **h**; brief input 8d). `screen-recognition`
  proves the _reading_ per mode on drawn fixtures; this feature proves the _capture_ per mode.

This feature adds the cascade, a cheap steady state and the telemetry that makes a field session readable. It does not
touch the reading logic: `screen_reader.rs`, `anchors.rs`, `layout.rs` and the other reading modules
(`scripts/agent/reading-modules.json`) are out of scope, and the wide automap search that runs on every in-game frame is
being throttled on `feat/F2-screen-recognition-2`, which this feature does not duplicate.

## Requirements

A **method** is one way to get the game window's pixels into the agent's memory: `print-window` (today's),
`graphics-capture` (the Windows Graphics Capture of the game window) and `screen-crop` (a copy of the game's client
rectangle from the screen; present only if the field matrix shows it is needed, see CAP-04 and the Decisions). A frame
is **blank** when `frame_content::summarize` says so (uniform or near-black); a capture that returns no frame is a
**failed** capture. Both are **unusable**.

- **CAP-01** — WHEN the agent captures the game THEN it SHALL try the methods in the fixed order `print-window`,
  `graphics-capture`, `screen-crop` and SHALL use the first one that returns a usable frame. A method the PC cannot
  offer (an older Windows build, a failed device) SHALL be skipped without an error to the player.
- **CAP-02** — WHILE the current method returns an unusable frame for three consecutive looks THEN the agent SHALL move to
  the next method, and WHEN every method is unusable THEN the screen SHALL read `UNKNOWN` and the window SHALL say that
  the capture shows nothing (a fixed reason code, never a guess). A blank frame SHALL NOT be passed to the screen
  reader or the Party step: no OCR call is made for it.
- **CAP-03** — WHILE a method works THEN the agent SHALL make one capture per look (one look per second at most, CHR-03)
  and SHALL NOT capture with a second method. WHILE a later method is in use, the agent SHALL probe the earlier ones
  with one capture every sixty looks, and SHALL return to the first that returns a usable frame. A probe adds one
  capture and never an OCR call unless its frame is usable and replaces the current one.
- **CAP-04** — Every method SHALL copy only the pixels of the game window's client area, and SHALL reduce its output to
  exactly that area before the frame leaves the capture adapter (title bar and borders of a windowed game cropped
  away, a frame whose size is not the client's size refused). `graphics-capture` SHALL be created from the game window
  itself, with the cursor and the window border off where Windows allows it. `screen-crop` SHALL copy only the client
  rectangle, and only WHILE the game window is the foreground window, visible and not minimized. No method SHALL capture
  a monitor, the desktop or another window (ADR 010).
- **CAP-05** — WHILE the game window is minimized, has no client area or is not running, or WHILE consent is not given,
  the agent SHALL capture with no method (CHR-01, CHR-02, CHR-03); WHEN consent is withdrawn, every capture session
  the cascade holds SHALL be closed before the next look.
- **CAP-06** — WHEN the window mode, the client size or the display scale changes (window to full screen, a resize, a
  monitor move) THEN the cascade SHALL read the new client area, SHALL discard a frame whose size does not match it, and
  SHALL look again from the current method, without a restart. A dark but drawn frame (low brightness, a loading
  screen with text) SHALL NOT be treated as blank.
- **CAP-07** — The heartbeat's `capture.method` SHALL be the current method's fixed word (`print-window`,
  `graphics-capture`, `screen-crop`) or `none`, and `capture.readRate` SHALL be the share of the last sixty looks that
  returned a usable frame, 0 to 1 (0 when there was no look). No contract change: both fields exist and keep their
  limits.
- **CAP-08** — Each capture SHALL be one span `agent.vision.capture` with two attributes of fixed vocabulary:
  `capture.method` (the CAP-07 words) and `capture.outcome` (`frame`, `blank`, `failed`, `skipped`); nothing else (no
  size, no coordinate, no pixel, no window title). The exporter's sanitiser SHALL keep those two keys with those values
  only (rule 10; SCR-09 for the vision keys).
- **CAP-09** — Every handle, device, session and frame pool a method creates SHALL be released on every path, including a
  failed capture, a demotion and a panic of a method, and the frame SHALL never leave the process (ADR 010, NFR-04). A
  method that panics SHALL count as a failed capture, never as a crash of the screen loop.
- **CAP-10** — The agent SHALL work, with no game configuration, in windowed, borderless and full-screen modes, with legacy
  graphics and at low and high brightness: the maintainer's field matrix SHALL record, per mode, which method worked,
  the screen the site showed, and the agent's average CPU over a session of 30 minutes or more below 2% with no FPS drop
  the maintainer can notice (NFR-02, NFR-03).

## Sources

| ID     | Source                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| CAP-01 | NFR-03; ADR 010 (window capture cascade); Design Doc § Agente (`vision`: window, then monitor) and § Riscos       |
| CAP-02 | NFR-03; NFR-02 (no OCR on a blank frame); the Windows incident of 2026-11-19 (`frame_content`)                    |
| CAP-03 | NFR-02; CHR-03 (at most once per second); F2 brief performance criterion                                          |
| CAP-04 | NFR-04; ADR 010 (never capture outside the game window); AGENTS.md rule 5; CHR-03 (the largest game window)       |
| CAP-05 | CHR-01, CHR-02, CHR-03; NFR-05 (consent)                                                                          |
| CAP-06 | NFR-03; F1 post-close item h; lessons ("Agent reading": window vs full screen); `screen-recognition` SCR-07       |
| CAP-07 | Design Doc § Contratos (heartbeat `capture`); `packages/contracts/src/http/agents.ts` (`method` ≤ 32, `readRate`) |
| CAP-08 | AGENTS.md rule 10; `docs/engineering/telemetry.md`; SCR-09 (fixed vocabulary, `sanitize.rs`)                      |
| CAP-09 | NFR-04; ADR 010; AGS-20 (frames stay in the process); `unsafe` policy of the agent rules                          |
| CAP-10 | NFR-02, NFR-03; F2 brief robustness and performance criteria; F1 post-close item h; brief input 8d                |

## Requirement Traceability

| Requirement ID | Story                | Proof                                                                                                                                              |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-01         | A second way to see  | Rust unit tests on the cascade (order, skipped methods) + acceptance `@CAP-01`; field matrix                                                       |
| CAP-02         | No OCR on black      | Rust unit tests with call counts (zero reader calls on blank) + acceptance `@CAP-02`                                                               |
| CAP-03         | Cheap steady state   | Rust unit tests with capture and OCR call counts over 600 looks; field CPU (CAP-10)                                                                |
| CAP-04         | Game window only     | Rust unit tests on the crop, size refusal and foreground rule; source-rule test (no monitor, no desktop DC); security review; acceptance `@CAP-04` |
| CAP-05         | Consent and minimize | Rust unit tests (no capture call without consent or window) + acceptance `@CAP-05`                                                                 |
| CAP-06         | Mode and size change | Rust unit tests (size change, dark drawn frame) + drawn fixtures + acceptance `@CAP-06`; field matrix                                              |
| CAP-07         | Honest heartbeat     | Rust unit tests (`translate.rs` body, read rate window) + acceptance `@CAP-07` (agent window)                                                      |
| CAP-08         | Telemetry            | Rust unit tests with the in-memory exporter + `sanitize.rs` tests + source-rule test (no size or text in span)                                     |
| CAP-09         | No leaks             | Rust unit tests with a fake method (release counts, panic) + CI Windows check (`agent-build`) + security review                                    |
| CAP-10         | Every mode, low CPU  | The maintainer's field matrix and CPU log (needs the maintainer's PC)                                                                              |

## Stories

- As a player, I want the site to show my screen even when the game's renderer returns black to one capture method, so
  that I trust that the agent sees me (CAP-01, CAP-02, CAP-06).
- As a player, I want the agent to cost almost no CPU and no FPS while I play (CAP-03, CAP-10).
- As a player, I want the agent to look only at the game window, only when I consented, and never at my desktop or my
  other windows (CAP-04, CAP-05, CAP-09).
- As the maintainer, I want the heartbeat and the traces to say which method worked on each PC, so that a field session is
  readable without the player (CAP-07, CAP-08, CAP-10).

## Threat per requirement (for the security review)

| ID     | Threat                                                                                                                   | Control                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-01 | A fallback method widens what is captured (a monitor, a second window)                                                   | The methods are a closed enum; each is a window-or-client-rectangle capture; the order and set are unit-tested                                                                                                                                                                                                                    |
| CAP-02 | A blank-frame retry loop spins and costs CPU, or hides a failure                                                         | Three looks before demotion; unusable frames never reach OCR; the reason is a fixed code                                                                                                                                                                                                                                          |
| CAP-03 | The probe becomes a second capture every look (CPU, and more pixels read than needed)                                    | One probe per sixty looks, capture only; call-count tests fail if the steady state makes two captures                                                                                                                                                                                                                             |
| CAP-04 | `screen-crop` copies pixels of another window drawn over the game (a chat overlay, a password manager) or of the desktop | Only the client rectangle, only while the game is the foreground, visible and not minimized; the frame is never stored or sent; on any doubt the method returns no frame; WGC and `print-window` are window-bound by construction. Residual risk (a topmost overlay inside the rectangle) is named in the PR and the decision log |
| CAP-04 | Windows' capture border or cursor leaks cursor pixels or alarms the player                                               | Cursor capture off; the border is Windows' own indicator and is left on where Windows requires it (a visible sign of capture)                                                                                                                                                                                                     |
| CAP-05 | Capture continues after consent is withdrawn or while the game is minimized                                              | The consent and window checks run before any method; sessions are closed on withdrawal (unit-tested)                                                                                                                                                                                                                              |
| CAP-06 | A frame of the wrong size reads regions of another layout                                                                | A size mismatch refuses the frame; the reader's supported-size rule stays (`UNKNOWN`)                                                                                                                                                                                                                                             |
| CAP-07 | The method word or read rate leaks something identifying                                                                 | Three fixed words and a number; no title, process, path or size                                                                                                                                                                                                                                                                   |
| CAP-08 | A span carries a window title, size or read text                                                                         | Two keys with fixed values in the sanitiser; a source-rule test refuses others in the capture code                                                                                                                                                                                                                                |
| CAP-09 | A leaked device or session keeps capturing, or a panic leaves a session open                                             | RAII wrappers, release counts in unit tests, panics caught at the method boundary; CI Windows check                                                                                                                                                                                                                               |
| CAP-10 | A field log or CPU number contains a screenshot or personal data                                                         | The log holds method, screen and CPU numbers only; no screenshot is attached to the repository (rule on prints)                                                                                                                                                                                                                   |

## Decisions (conservative defaults)

- **`screen-crop` is in the spec but is built last, and only if the field matrix needs it.** It is the one method that
  reads from the screen's pixels (restricted to the client rectangle), so it carries the highest ADR 010 risk. Tasks for
  the first two methods, the cascade and the telemetry do not wait; the `screen-crop` task starts only when the
  maintainer's matrix (brief input 8d) shows a mode where `print-window` and `graphics-capture` are both blank.
  If the matrix never shows one, the method is not built and CAP-01's order reads `print-window`, `graphics-capture`.
- **`graphics-capture` uses the `windows` crate's WinRT and Direct3D features** the app already depends on; no new crate
  (ADR 010 names `windows-capture` as a family of approach, not a dependency). Each added feature is reviewed against
  `deny.toml` and the source-rule test's feature list; none that reaches memory, input, hooks or processes.
- **Three looks before demotion; sixty looks between probes.** A short black frame (a loading screen, a cinematic) must not
  flip the method, and a probe adds one capture per minute at most. The numbers are domain constants,
  pinned by tests, and become remote configuration in `remote-config`.
- **`readRate` is the share of usable captures**, not an OCR read rate: the heartbeat field's meaning in the Design Doc is
  open, and a capture rate is the one the agent can state without reading text.
- **A drawn dark frame is not blank.** The existing thresholds of `frame_content` are kept and pinned by a
  low-brightness drawn fixture; they change only if the field matrix shows a false blank.
- **No change to the reading modules, `.quality-baseline.json` or `mutants.toml`.** If a task seems to need one, it stops
  (rule 14, rule 4). The PR still carries `ocr-real` and `ocr-variations` counts as a no-regression record.
- **Exclusive full screen** that stays black in every method is reported honestly (`UNKNOWN` and a window message that
  names the capture, not a game setting to change); presence by process and heartbeat is unchanged (NFR-03: no game
  configuration is required of the player).
- **Orchestrator answers to the draft (F2-ORQ004).** `screen-crop` stays conditional on the field matrix (T14). The
  sensor edit O1 is the orchestrator's. `graphics-capture` uses the `windows` crate's WinRT and Direct3D features, no new
  crate. The Windows capture border stays on where the OS requires it. `readRate` is the share of usable captures. The
  3 and 60 constants live in the domain, pinned by tests.
