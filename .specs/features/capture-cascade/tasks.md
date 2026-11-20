# Capture cascade — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-capture-cascade` → `phase/F2`
(the branch is based on `feat/F2-screen-recognition` until PR #93 merges; the orchestrator then rebases it onto `phase/F2`)

Paths below are relative to `apps/agent/src-tauri` unless they start with `apps/`, `scripts/`, `tests/` or `.specs/`.
`CARGO` stands for `cargo … --manifest-path apps/agent/src-tauri/Cargo.toml`.

In a fresh checkout run `pnpm install --frozen-lockfile` and `pnpm --filter @d2rmm/agent build` once before the first gate
that runs `cargo clippy` on the app crate (it needs `apps/agent/dist`; lessons). The gates below that name a crate
(`-p d2rmm-agent-domain`, `-core`, `-adapters`) need neither.

## Rules for this feature

**NFR-02 call counts.** Every task that changes what the loop captures or reads carries a unit test that counts calls: the
captures per method and the `FrameReader::read` calls over a fixed number of looks (600). A task whose change could add a
capture or an OCR call per look and has no such test is incomplete. Do not touch the automap or HUD search (the
`feat/F2-screen-recognition-2` branch throttles it; no duplicate).

**Rule 14 (OCR protection).** No task here changes a non-test line of a reading module
(`scripts/agent/reading-modules.json`: `anchors.rs`, `character_screen.rs`, `characters.rs`, `layout.rs`,
`game_name_match.rs`, `language.rs`, `vocabulary.rs`, `vision.rs`, `name_diff.rs`, `hud_track.rs`, `party.rs`,
`screen_reader.rs`). If a task seems to need it, stop and return it. The PR's CI shows `ocr-real` and `ocr-variations`
unchanged; the orchestrator writes the counts in the PR description as a no-regression record (T10). Never edit
`reading-modules.json`, `.cargo/mutants.toml` or `.quality-baseline.json` (the gate asks the maintainer; AGENTS.md rule 4).

**ADR 010.** No task adds a method that can capture a monitor, the desktop or another window. A method that cannot be
bounded to the game's client rectangle is returned, not shipped.

**Fixtures.** Fixtures are drawn by `xtask` and committed; a real print or capture is never read into the repository or
committed. Field logs hold method names, screens and CPU numbers only.

**Mutation never appears in a gate** (ADR 029). The nightly lists survivors in the new domain and core files; each is killed
by a pinning test.

**Windows code.** The Win32 and WinRT adapters compile on Windows only. On Linux the worker runs the pure tests; the Windows
check is `node scripts/agent/win-check.mjs` (Docker, clippy for `x86_64-pc-windows-msvc`) when Docker runs, else the
`agent-build` job on the PR. Mark in the report which one proved a Windows task.

## Batch 1 — pure cascade and wiring, runs in the cloud (Linux), no maintainer input

- [x] T1 — **Pin today's behaviour first (tests only).** In `core/src/watch_screen.rs`, `adapters/src/http/translate.rs` and
      `domain/src/frame_content.rs` add tests that pass on the unchanged code: a tick on a blank frame calls the reader
      once (the behaviour T5 changes; T5 replaces that expectation with the reason in its commit), the heartbeat body
      carries `capture.method == "none"` and `readRate == 0`, `summarize` calls a drawn dark frame (mean 20, spread 40)
      not blank and a uniform one blank, and `largest_client` still picks the biggest client area. No non-test line
      changes; no test ignored. Gate: `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core -p d2rmm-agent-adapters --lib`
      and `CARGO clippy -p d2rmm-agent-domain -p d2rmm-agent-core -p d2rmm-agent-adapters --all-targets -- -D warnings`
- [x] T2 — The cascade state machine (CAP-01, CAP-02, CAP-03, CAP-07). New `domain/src/capture_cascade.rs`, exported from
      `lib.rs`: `CaptureMethod` (`PrintWindow`, `GraphicsCapture`, `ScreenCrop`, `word()`), `Outcome`, `Cascade` with
      `DEMOTE_AFTER = 3`, `PROBE_EVERY = 60`, `RATE_WINDOW = 60` as pinned constants. Tests: order and skipping of
      unavailable methods; no demotion on two unusable looks, demotion on three consecutive (a usable look resets the
      run); a probe exactly every sixtieth look and never in steady state on the first method; promotion on a usable
      probe; read rate over the last 60 looks (0 with no look); a 600-look loop counts captures per method (steady state
      600, one probe per sixty adds 10). No clock, randomness or I/O. Gate: as T1
- [x] T3 — Client-area geometry (CAP-04, CAP-06). New `domain/src/capture_geometry.rs`: `crop_to_client`
      (frame, client offset, client size) returns the rectangle to keep or `None` when the frame cannot hold the client area or the sizes do not
      match; tests for a windowed frame with a title bar and borders (offset 8,31 as `window_capture` tests use), a
      borderless one (offset 0,0), a frame smaller than the client, a zero-size client and overflow at `u32::MAX`.
      Gate: as T1
- [x] T4 — The port and the `Capturer` (CAP-01, CAP-02, CAP-03, CAP-05, CAP-09). In `core/src/ports.rs` add `methods()`,
      `capture_with(method)` and `release()` to `FrameSource` with the defaults of the design; new `core/src/capturer.rs`
      owning the `Cascade` behind a `Mutex` (`PoisonError::into_inner`) and calling the port inside `catch_unwind`. Tests
      with a scripted fake source (`core/src/fakes.rs`): no call at all without consent or while the game does not
      run; `release()` called once on consent withdrawn and on a demotion; a panic in a method is a failed capture; a
      frame whose size is not the client's is unusable; calls per method over 600 looks (steady 600, probe 10, none
      after a demotion to the first method). Existing fakes compile unchanged. Gate: as T1
- [x] T5 — Wire the loop (CAP-02, CAP-05, CAP-07). `watch_screen::tick` asks the `Capturer`: an unusable look sets
      `Unknown`, sets the capture view and the window's reason code, and returns before `read_screen` and the Party
      step. `CaptureView` gains `method` (the fixed word) and `read_rate`. Change the T1 blank-frame test to expect zero
      reader calls and say why in the commit; add the call-count tests: 600 usable looks make 600 `read` calls, 600
      blank looks make 0, a demotion mid-session loses no `read`. `screen_reader.rs` is not touched. Gate: as T1
- [x] T6 — Heartbeat and telemetry (CAP-07, CAP-08). `translate.rs` sends the hub's method word and read rate (T1's
      expectation becomes `none`/0 only before the first look); span `agent.vision.capture` with `capture.method` and
      `capture.outcome` around each capture (a probe is its own span); `sanitize.rs` keeps the two keys with their fixed
      values only and drops any other value (every value outside the words, every case: a size, a title, a path). Tests
      with the in-memory exporter; existing span tests gain assertions, never lose one. A source-rule test in
      `scripts/test/` refuses a size, coordinate, text or window title in an attribute of the capture code. Gate: as T1 and
      `pnpm test:harness`
- [x] T7 — The window and its strings (CAP-02, CAP-07; rule 9). `apps/agent/src/views` shows the capture method label (`Window print`, `Graphics capture`, `Screen crop`, `None`) and "the capture shows nothing" for the unusable reason code, from
      `shared/locales/en.json` and `pt-BR.json` (no string in a component). Tests in `views.test.tsx`: each label, the
      reason, pt-BR. Gate: `pnpm --filter @d2rmm/agent test` and `pnpm --filter @d2rmm/agent typecheck`
- [x] T8 — Drawn fixtures and the headless methods (CAP-01 to CAP-07). `xtask draw-fixture` draws
      `in-game-window-with-title-bar` (a whole-window frame, drawn title bar, sidecar client offset) and
      `in-game-wrong-size-frame`, reusing the HUD lines of `in-game-window`; the headless example (`adapters/examples/headless.rs`) gets scripted methods (`black`, `unavailable`, `wrong-size`, `minimized`) and the lines the steps
      send. Draw with the repository's open font; no capture is committed. Gate:
      `CARGO run -p xtask -- draw-fixture screens && git diff --exit-code apps/agent/fixtures && CARGO nextest run -p xtask --lib`
      (commit the new files first, then run the gate; the drawing is deterministic)
- [x] T9 — Acceptance steps for the `@CAP-` scenarios in `tests/acceptance/steps/capture-cascade.steps.ts`, reusing the
      consent, "the game shows the fixture" and "the site shows the agent's screen as" steps of
      `characters-reading.steps.ts`; new steps for the scripted methods, the agent window's capture method and reason,
      withdrawing consent and the minimized window. Never edit `acceptance.feature`. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @CAP-` and `node scripts/acceptance-check.mjs capture-cascade`

## Orchestrator (local; the maintainer answers the gate where it asks)

- [x] O1 — Sensors for the new adapters. In `scripts/test/agent-source-rules.test.mjs` add `src/adapters/graphics_capture.rs`
      (and `screen_crop.rs` only when T14 starts) to the unsafe allowlist with the exact `windows::` paths each names, and
      the `windows` features the capture needs to the feature list, one comment per feature saying why. No feature that
      reaches memory, input, hooks or process handles (`deny.toml`). The security reviewer reads this edit first. Gate:
      `pnpm test:harness`

## Batch 2 — Windows adapters, written in the cloud, proved by the Windows check and CI

- [ ] T10 — `graphics-capture` (CAP-01, CAP-04, CAP-09). New `src/adapters/graphics_capture.rs`: the Windows Graphics Capture of
      the game window (design, § Method adapters), with `FrameSource::methods` omitting it when
      `GraphicsCaptureSession::IsSupported()` is false, cursor capture off, the frame cropped with `crop_to_client`, RAII
      wrappers that release the device, pool, session and staging texture on every path and in `release()`. The pure parts
      (extended-bounds to client offset, BGRA to RGBA through `rgba_from_bgra`) are tested everywhere; the Win32 calls are
      `#[cfg(windows)]` with a `// SAFETY:` comment each. Needs O1 first. Run `cargo deny --locked check` once: the task
      adds `windows` features, not a crate, and must not change the bans. Gate:
      `CARGO nextest run -p d2rmm-agent --lib` (pure parts; needs `pnpm --filter @d2rmm/agent build` and the Tauri system
      libraries on Linux) and `node scripts/agent/win-check.mjs`
- [ ] T11 — Compose the cascade in the app (CAP-01, CAP-09). `src/adapters/window_capture.rs` implements `methods`,
      `capture_with` and `release` for `print-window` and delegates the second method to `graphics_capture`; `app.rs` builds
      the `Capturer`; `--self-check` stays as it is (it must still print and exit with no game running). The unsafe
      policy file list in the module header is updated. Gate: as T10, plus `node scripts/test/agent-source-rules.test.mjs`
      through `pnpm test:harness`
- [ ] T12 — Close the proofs. Write the PR's table: unit-test counts, call counts (captures and reads per 600 looks), `ocr-real`
      per print and `ocr-variations` counts before (`phase/F2` baseline) and after (expected: unchanged), the Windows
      check result, and the threat table of the spec with the control that closes each line. Fix rounds per feature. Gate:
      `pnpm specs:check && pnpm test:harness`

## Batch 3 — waits for the maintainer's field matrix (brief input 8d; needs the maintainer's PC)

These wait; nothing in batches 1 and 2 depends on them. They use the per-PR test installer built from this branch.

- [ ] T13 — Field matrix (CAP-10, F1 post-close item h). On the maintainer's PC, in windowed, borderless and full-screen
      modes, with legacy graphics (G) and at low and high brightness: for each cell, the method the agent window shows,
      the screen the site shows, and "blank" or not. The log is method names and screens only. Needs the maintainer's PC.
- [ ] T14 — `screen-crop` — **only if T13 shows a cell where `print-window` and `graphics-capture` are both blank.** Then
      new `src/adapters/screen_crop.rs` (design, § Method adapters): client rectangle only, foreground-only, any doubt
      returns no frame; add it to O1's allowlist first; security review of this method alone; drawn-fixture and
      call-count tests as T4. If T13 shows no such cell, this task is closed unbuilt and the spec's Decisions say so.
      Gate: as T10
- [ ] T15 — CPU and FPS (CAP-10, NFR-02). A session of 30 minutes or more per working method, average agent CPU below 2%
      and no FPS drop the maintainer notices; record the numbers beside T13's. Needs the maintainer's PC.
- [ ] T16 — Fix what the field shows (CAP-06, CAP-10): for each cell that reads wrongly, a pinning test or drawn fixture
      first, then the smallest change, then the call-count test. If it needs a reading module, return it to the
      orchestrator (rule 14).
