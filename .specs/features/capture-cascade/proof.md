# Capture cascade — proof record (T12)

For the PR description. Numbers are from this branch after merging `phase/F2`.

## Tests

| Check                                                                   | Result                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `cargo nextest run -p domain -p core -p adapters -p d2rmm-agent --lib`  | 742 passed                                                                                                   |
| `cargo clippy --all-targets -D warnings` (same crates)                  | clean                                                                                                        |
| Windows target clippy `-D warnings` (scratch crate over the real files) | clean; `WindowMethods` and `Capturer` are `Send + Sync`                                                      |
| `pnpm test:harness`                                                     | 568 passed (agent source rules 41/41 with O1)                                                                |
| `pnpm --filter @d2rmm/agent test` / `typecheck`                         | 62 passed / clean                                                                                            |
| `pnpm specs:check`, `acceptance-check capture-cascade`                  | OK                                                                                                           |
| `@CAP-` acceptance scenarios                                            | not run locally (Docker Hub 429 on `postgres:17-alpine`); step generation, eslint and tsc pass; CI runs them |
| `ocr-real` / `ocr-variations`                                           | CI only (Windows). No reading module changed: expect unchanged counts                                        |

## Call counts (NFR-02, unit tests)

| Test                                    | Captures                 | OCR reads |
| --------------------------------------- | ------------------------ | --------- |
| Cascade, 600 steady looks               | 600, 0 probes            | -         |
| Cascade, 600 looks on the second method | 10 probes                | -         |
| Capturer, 600 steady looks              | 600 of one method        | -         |
| Capturer, 600 looks after a demotion    | 598 + 13 (3 + 10 probes) | -         |
| Loop, 600 blank looks                   | 600                      | **0**     |
| Loop, 600 usable looks                  | 600                      | 600       |

## Threat table: the control that closes each line

| ID     | Control in the code                                                                                               | Proof                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| CAP-01 | `CaptureMethod` is a closed enum; the order is `ORDER`; `Cascade::new` drops methods the PC does not offer        | `capture_cascade` tests                                                   |
| CAP-02 | Three looks before demotion; `Capturer` drops blank frames; `tick` checks again before the reader                 | `capturer`, `watch_screen` tests (0 reads)                                |
| CAP-03 | One probe per 60 looks; never on the first method                                                                 | call counts above                                                         |
| CAP-04 | Item made from the game window handle; cursor off; crop to client; size mismatch refused; `screen-crop` not built | `capture_geometry`, `graphics_capture`, `capturer` tests; security review |
| CAP-05 | `release()` on no consent or no game; `Miss::NoWindow` demotes nothing                                            | `capturer`, `watch_screen` tests                                          |
| CAP-06 | Client size judged per look; dark drawn frame not blank (pinned)                                                  | `frame_content`, `capturer` tests                                         |
| CAP-07 | Heartbeat carries the method word and usable share                                                                | `translate` test                                                          |
| CAP-08 | Two span keys with fixed words; sanitiser and source rule enforce them                                            | sanitiser tests, `agent-vision-span-rules`                                |
| CAP-09 | RAII `Session` (`Drop` closes session and pool); panics caught in `Capturer`                                      | `capturer` tests; Windows clippy                                          |
| CAP-10 | Field matrix (batch 3)                                                                                            | maintainer's PC                                                           |

## Decisions and deviations

- `MethodSource` is a second port; `FrameSource` only gains `status()` and `release()` (design.md updated).
- `Miss::NoWindow` keeps a minimized game from demoting a method.
- A session keeps its last frame: Windows delivers a frame on change only, and a still window must not read as "no frame".
- The window's border is left to Windows where it is required (decision 4); `SetIsBorderRequired(false)` is tried and its refusal ignored.
- Fix rounds: 0 reviewer rounds so far.
