# Screen recognition — CPU cost of the pt-BR fallback pack

Question (NFR-02, brief exit criterion "Performance"): what does reading every frame with a second language pack cost
against the budget of 2% average CPU, and does the case where both packs are always asked need a guard? Nothing in a
reading module was changed to measure it (rule 14); the numbers come from the pinned tests of batch 7 (T15) in
`core/src/screen_reader.rs`, `party.rs` and `chat_step.rs`.

## Where each number comes from

| Quantity                    | Value                                                                                       | Source                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Look period                 | 1 look a second, never faster                                                               | `core/src/watch_screen.rs` `TICK`, `look_interval` (CHR-03, RCF-09)                                                   |
| Blank frames                | never read, no OCR call                                                                     | `watch_screen.rs` `tick` (CAP-02); so a black frame costs nothing and is not an `Unknown` case                        |
| Engine calls per trait read | `read` 1, `read_lines` 1, `read_variants` 6, `read_line_variants` 6                         | `adapters`/`src/adapters/windows_ocr.rs`: nearest 3× plus the five `EXTRA_VARIANTS`, one `RecognizeAsync` each        |
| Engine calls per frame      | counted by the `Metered` reader in `screen_reader.rs` tests (trait reads × the line above)  | tests `an_english_client_in_steady_state…`, `a_pt_br_client_in_steady_state…`, `a_frame_unknown_in_both_languages…`   |
| Time of one engine call     | **not measured; no timing exists in the repository** (no `ocr-real` log or doc carries one) | **Assumption**, labelled below: 5, 15 and 30 ms per call                                                              |
| Budget                      | 2% average CPU                                                                              | `docs/engineering/constraints.md` NFR-02; the PRD does not say of one core or of the machine, so the table gives both |

## Passes and engine calls per frame

A pass is one `ScreenReader::read_own` (one language pack). Party and chat match the fallback words against lines the
first pass already read, so they add **no** second OCR pass (tests `the_fallback_pack_reads_the_panel_with_no_second_ocr_pass`,
`the_fallback_pack_reads_the_chat_with_no_second_ocr_pass`).

| Scenario                                   | Passes per frame            | Engine calls per frame (one pass)       | Engine calls per frame (total)         |
| ------------------------------------------ | --------------------------- | --------------------------------------- | -------------------------------------- |
| English client, automap open               | 1                           | 6                                       | 6                                      |
| English client, in game (HUD tracked)      | 1                           | 12                                      | 12                                     |
| English client, character selection        | 1                           | 60                                      | 60                                     |
| pt-BR client, same three screens           | 1 (first frame 2)           | 6 / 12 / 60 (first frame 48 / 54 / 102) | 6 / 12 / 60                            |
| `Unknown` in both (menu, loading, desktop) | **2, every frame, forever** | 42 and 30 alternate (English pass)      | **84 and 60 alternate, 72 on average** |

Over 600 `Unknown` frames the cost never settles: the order flips only when a pack reads a known screen, and here none
does, so English goes first and pt-BR is asked every time. The wide-area searches rest on their own cadence, which is
the only reason the cost alternates between 84 and 60. An English-only reader would pay half of it (36 on average), so
the fallback **adds 36 engine calls to every `Unknown` frame** and nothing to a known one.

## Estimated share of the budget

Core time per second = engine calls × time per call (one look a second). The budget is 2% of one core (20 ms a second)
or, taken as machine-wide on an 8-thread desktop, 2% of eight cores (160 ms a second); half of it is 10 or 80 ms.

| Scenario                          | Engine calls / s | At 5 ms (ms/s) | At 15 ms | At 30 ms | Share of the machine-wide budget (8 threads), 5 / 15 / 30 ms |
| --------------------------------- | ---------------- | -------------- | -------- | -------- | ------------------------------------------------------------ |
| English or pt-BR, automap         | 6                | 30             | 90       | 180      | 19% / 56% / 113%                                             |
| English or pt-BR, in game         | 12               | 60             | 180      | 360      | 38% / 113% / 225%                                            |
| English or pt-BR, selection       | 60               | 300            | 900      | 1800     | 188% / 563% / 1125%                                          |
| `Unknown` in both (English alone) | 36               | 180            | 540      | 1080     | 113% / 338% / 675%                                           |
| **`Unknown` in both (shipped)**   | **72**           | **360**        | **1080** | **2160** | **225% / 675% / 1350%**                                      |

These are core-seconds a second, so they only say the order of magnitude; every figure rests on the **assumed** time per
call, and the ratios between rows are the part that does not. The break-even is independent of any assumption: with `t`
ms per call and `c` threads, the `Unknown`-in-both case exceeds half the budget when `72·t > 0.5 · 0.02 · c · 1000`, that
is `t > 0.14·c` ms: above 1.1 ms on 8 threads, above 2.2 ms on 16. A Windows OCR call on a crop enlarged three to five
times is very unlikely to run in that little, but the cost of a call grows with the crop's area (a tracked HUD box is far
smaller than a character list column), so the flat 5, 15 and 30 ms overstate the small reads and understate the large
ones. That is a second reason the absolute shares above are an order of magnitude, not a result.

## Answer

- **The `Unknown`-in-both case exceeds half the budget: yes**, by the assumption's whole range, and so does the plain
  in-game HUD at 15 ms or more. The fallback is not what makes those frames expensive (the English pass alone is 36 a
  frame), but it doubles them, and `Unknown` is the state of a player in the main menu, a loading screen or off the game.
- A known screen, English or pt-BR, pays one pass: **the fallback costs nothing in steady state**, which is what the
  ordering of the packs (the language that read the last frame goes first) is for.
- **The guard (T17, done in batch 8)**: the second pack is asked on the first `Unknown` frame of a run and then every 5th
  (`SECOND_PACK_EVERY`), so the average `Unknown` frame falls from 72 to 43 engine calls (English alone: 36). "No anchor at
  all" could not be the criterion: an `Unknown` reading drops the partial-anchor counts, so a pt-BR screen the English
  words miss looks the same as a menu. The bound keeps pt-BR recognised on the first frame and within 4 s after an
  `Unknown` run. It changes a non-test line of `screen_reader.rs`: the real-print proof (`ocr-real`, `ocr-variations`) is
  run by CI (rule 14).

## What this does not prove

- The time per engine call and the machine's thread count: the repository has no timing. T14 (the 30-minute field
  session, the agent's CPU telemetry on the maintainer's PC) is the measure; it replaces the three assumed columns.
- The `Unknown` counts come from drawn fixtures whose reader returns no line on those areas. A real loading screen or
  desktop with text in the search areas can make the engine and the anchors do more (never fewer) reads than counted.
- The guard's effect on real frames: it needs the `ocr-real` and `ocr-variations` runs (CI), and the saving is 29 of 72
  calls on an `Unknown` frame at the assumed counts, not a measured CPU figure.
