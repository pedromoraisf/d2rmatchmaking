# Capture cascade — Design

Short. The agent keeps its hexagonal shape (ADR 027): `adapters → core → domain`. The cascade is a decision (which
method, when to demote, when to probe) kept pure in the domain, owned by one object in the core, and two Win32 adapters
that only return a frame. Nothing here adds a route, a contract field or a crate.

## Principle

The agent asks for **one frame per look from the first method that works**, and stops asking an earlier method until a
probe says it works again. A frame that is blank or fails is never read. Every method returns the game's **client area
and nothing else**, so the reading's regions (fractions of the client) mean the same thing whichever method produced the
frame. The reading logic does not change.

## Modules and layers

| Layer   | File (`apps/agent/src-tauri/…`)                                                    | Change                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain  | `domain/src/capture_cascade.rs` (new)                                              | `CaptureMethod` (closed enum + `word()`), `Outcome`, `Cascade`: pure state machine, constants `DEMOTE_AFTER = 3`, `PROBE_EVERY = 60`, `RATE_WINDOW = 60` |
| domain  | `domain/src/capture_geometry.rs` (new)                                             | `crop_to_client(frame_size, client_offset, client_size)` → the rectangle to keep, or `None` (size mismatch)                                              |
| domain  | `domain/src/frame_content.rs`                                                      | unchanged; `summarize` is the blank test the cascade uses (pinned by a new dark-frame test)                                                              |
| core    | `core/src/ports.rs`                                                                | `FrameSource` gains `methods()` and `capture_with(method)`; defaults keep `capture()` = `print-window` (fakes unchanged)                                 |
| core    | `core/src/capturer.rs` (new)                                                       | `Capturer`: owns the `Cascade` behind a `Mutex`; `look() → Look { frame, method, outcome }`; closes sessions on consent off                              |
| core    | `core/src/watch_screen.rs`                                                         | `tick` asks the `Capturer`; a blank or failed look sets `Unknown`, records `agent.vision.capture`, skips `read_screen` and the Party step                |
| core    | `core/src/view.rs`, `core/src/hub.rs`                                              | `CaptureView` gains `method` and `read_rate`; the heartbeat reads them                                                                                   |
| adapter | `adapters/src/http/translate.rs`                                                   | `capture` is the hub's method word and rate (was the constant `none`, `0`)                                                                               |
| adapter | `adapters/src/telemetry/sanitize.rs`                                               | allows `capture.method` and `capture.outcome` with fixed values                                                                                          |
| app     | `src/adapters/window_capture.rs`                                                   | `print-window`: unchanged calls; gains the `FrameSource::methods`/`capture_with` wiring                                                                  |
| app     | `src/adapters/graphics_capture.rs` (new, `unsafe` allowlisted)                     | `graphics-capture`: WinRT `GraphicsCaptureItem` for the game window, one frame pool, one session, closed on release                                      |
| app     | `src/adapters/screen_crop.rs` (new, **only if the field matrix needs it**)         | `screen-crop`: copy of the client rectangle, foreground-only                                                                                             |
| app     | `ui` strings in `apps/agent/src/shared/locales/{en,pt-BR}.json`, `src/views`       | method label and "the capture shows nothing" (rule 9)                                                                                                    |
| tests   | `tests/acceptance/steps/capture-cascade.steps.ts`, `adapters/examples/headless.rs` | scripted methods (`black`, `unavailable`, `wrong-size`, `title-bar`), fixture sidecar offsets                                                            |

The cascade is **not** a reading module: it decides what is captured, never what is read. `scripts/agent/reading-modules.json`
is not edited. The unsafe allowlist and the Windows feature list in `scripts/test/agent-source-rules.test.mjs` are a
security sensor: widening them for the new adapters is the orchestrator's task (O1), read by the security reviewer; a
worker does not edit that file.

## Ports

`FrameSource` (core) stays the one port the screen loop holds. It gains `status()` (the method of the last usable frame,
the read rate and whether the last look gave none) and `release()` (close the capture sessions), both with defaults, so
every existing fake keeps compiling and behaving as before. A second port, `MethodSource`, is the raw side: the methods
the PC offers, `capture_with(method)`, the client size and `release()`. The `Capturer` implements `FrameSource` over a
`MethodSource`, so the loop does not know there is a cascade:

```rust
trait MethodSource { fn methods(&self) -> Vec<CaptureMethod>; fn capture_with(&self, m: CaptureMethod) -> Option<Rgba>;
                     fn client_size(&self) -> Option<(u32, u32)>; fn release(&self); }
```

The domain `Cascade` has no clock, no randomness and no I/O: `current()`, `probe()`, `record_probe(method, outcome)` and
`record(outcome) → Stay | Demoted(next)` where `Outcome` is `Frame | Blank | Failed`; the looks are counted, not timed, so
a test drives 600 looks in a loop. `Capturer` holds the state and is the only code that calls `capture_with`.

## Method adapters

- **`print-window`** — today's `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)`. Its output is already the client area.
- **`graphics-capture`** — `IGraphicsCaptureItemInterop::CreateForWindow(game hwnd)` (the item is the window, so no monitor
  or other window can be in it), a Direct3D 11 device, a free-threaded `Direct3D11CaptureFramePool` of one buffer and one
  `GraphicsCaptureSession` with cursor capture off (and the border off where the OS allows; the OS border is a visible
  sign of capture and stays where it is required). The item covers the whole window, so the frame is cropped to the
  client area with `crop_to_client` using `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` against `ClientToScreen`.
  A frame is copied to a staging texture and read once per look; the session and pool live until `release()`.
  Unavailable (`GraphicsCaptureSession::IsSupported()` false) means `methods()` omits it.
- **`screen-crop`** (conditional) — a copy of the game's client rectangle from the screen's device context, **only** while
  `GetForegroundWindow()` is the game window, it is visible and not minimized; any doubt returns no frame. It never
  asks for a monitor, the desktop or another window; the source rectangle is the client rectangle in screen
  coordinates. It is the last method and ships only if the field matrix needs it (spec, Decisions).

All Win32 and WinRT calls are on Windows only and in the two adapters; the pure parts (crop geometry, method order, state)
are compiled and tested everywhere. The Linux gate runs the domain and core tests; the Windows CI job (`agent-build`) and
`node scripts/agent/win-check.mjs` check the adapters.

## Data and state

- No persistence. The cascade state (current method, unusable run, looks since the last probe, a 60-look ring of
  outcomes) lives in the `Capturer` and is lost on restart; a restart starts at `print-window`.
- The method and the read rate go to the window (`CaptureView`) and to the heartbeat; nothing else about a frame.
- A frame, a rectangle and a window title are never stored, logged or put in a span.

## Look order per tick (cheap first)

1. No consent, game not running, or no client area → no method is called, `release()` when consent was withdrawn.
2. Capture with the current method. Usable → done (one capture).
3. Unusable → count it; after three in a row demote and capture with the next method in the same tick.
4. On a tick that is a probe (`PROBE_EVERY`), capture first with the earliest method that is cheaper than the current one;
   a usable probe frame becomes the look's frame and the method is promoted; an unusable probe is discarded and the
   current method captures as in step 2.
5. A usable frame goes to `read_screen` and the Party step as today; an unusable one sets `Unknown` and ends the tick.

## Proof strategy

- **Unit tests first**, in each module (domain `Cascade`, `crop_to_client`; core `Capturer` with a scripted fake source). Every
  test that changes what is called carries **call counts**: captures per method and `FrameReader::read` calls over 600
  looks (steady state = 600 captures and 600 reads, one probe per sixty adds 0 reads; blank = 0 reads). These are the
  NFR-02 guard the `screen-recognition` review asked for.
- **Drawn fixtures** by `xtask` (`draw-fixture`): reuse `in-game-window`, `in-game-fullscreen`, `in-game-low-brightness`;
  add `in-game-window-with-title-bar` (whole-window frame with a drawn title bar and a sidecar client offset) and
  `in-game-wrong-size-frame`. No capture is committed.
- **Real prints**: not touched. `ocr-real` and `ocr-variations` run in CI on the PR (it changes `apps/agent`) and their
  counts go in the PR description as a no-regression record.
- **Windows**: `agent-build` on `windows-latest` and `win-check.mjs`; the first run of a Win32 adapter on a real PC is the
  field matrix.

## Telemetry (rule 10, CAP-08)

A span `agent.vision.capture` per look (a probe is a second span with the same attributes):

| Attribute         | Values                                                    |
| ----------------- | --------------------------------------------------------- |
| `capture.method`  | `print-window`, `graphics-capture`, `screen-crop`, `none` |
| `capture.outcome` | `frame`, `blank`, `failed`, `skipped`                     |

`skipped` is "no consent, no game or no client area". No size, coordinate, title or pixel. The sanitiser keeps both keys
with those values only, like the vision keys of SCR-09. Existing span tests gain assertions and never lose one.

## Edge cases

- **Exclusive full screen that is black in every method**: `Unknown`, the window says "the capture shows nothing" (a fixed
  code), the heartbeat reports `none` and rate 0; presence by process continues. Not a game setting to change (NFR-03).
- **A resize or mode change**: the client area is read each look; a frame whose size differs from it is refused (CAP-06).
- **Windows 10 builds without the capture API or a failed D3D device**: `methods()` omits `graphics-capture`; the cascade is
  `print-window` alone, as today.
- **A method that panics** is caught at the `Capturer` boundary (`catch_unwind`) as a failed capture and `release()` runs.
- **Multi-monitor and DPI**: sizes are physical client pixels; a monitor move changes the client size and is a resize.

## ADRs

ADR 010 (read-only capture; window capture cascade), ADR 027 (hexagonal agent), ADR 026 (no mutation in gates) and
AGENTS.md rules 5, 10 and 14. No new ADR: a method that cannot be bounded to the game window is an escalation, not a
design choice.
