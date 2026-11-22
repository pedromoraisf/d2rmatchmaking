# T9 — Reason classes of the card screens (batch 9, analysis)

Source: the `ocr-variations` job of PR #154 (`phase/F2` plus the T17 guard, 2026-11-22): 8265 supported, 5727 correct,
2493 refused, 45 wrong. Reason classes and counts only; no read text. A count is a variation (one print, one
variant-set).

The card screens refuse 509 variations: `select-difficulty` (the popup print) 346 and `select-screen` 163. Every one
is `cards-refused-{read}of{expected}-slots{n}[-{kinds}]` from `classify_select` (`src/ocr_variations/outcome.rs:
cards_refused_reason`); the popup adds `-options{n}` (`classify_popup`).

## Classes by cause

| #   | Cause                                                                                                                      | popup | select | Total | Rule that refuses it                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----: | -----: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | No card anchored: `slots0` (no level line with a name line above it in any variant)                                        |   173 |     38 |   211 | `anchors.rs: find_cards` (`is_level`: level word and a level; `near`: name within `card_line_gap`), merged by `find_cards_in_variants`                                                                                                                                                                                          |
| B1  | `title-unread` alone, other fields read                                                                                    |    90 |     72 |   162 | `character_screen.rs: read_card` → `read_title_readings` (a found line: majority, a blank counts for no value, so two agreeing readings are needed), or `anchors.rs: find_cards` (`TitleLine::Unknown`, a line above the name that is no title) or `settle_unseen_title` (`UnseenTitle::Unread`, ink the band does not explain) |
| B2  | `title-unread` together with another unread field (class, level, name-unread, name-disagree) on the card or the other card |    58 |     22 |    80 | same rules; the title refuses first, the other field is only reported                                                                                                                                                                                                                                                           |
| C   | `name-disagree` without a title refusal                                                                                    |    13 |     21 |    34 | `character_screen.rs: name_or_reason` → `read_name_readings` (`majority`: two readings agree and no rival ties)                                                                                                                                                                                                                 |
| D1  | `level-unread` / `class-unread` without a title refusal                                                                    |     6 |      6 |    12 | `character_screen.rs: level_and_class` (`majority` of `parse_level_and_class`); `class-unread` = a level read, the class not settled                                                                                                                                                                                            |
| D2  | `name-unread` alone                                                                                                        |     0 |      3 |     3 | `name_or_reason` (no reading is a name)                                                                                                                                                                                                                                                                                         |
| E   | One card anchored, the other not, nothing refused (`1of2-slots1`)                                                          |     6 |      1 |     7 | `find_cards` (as A, for the second card)                                                                                                                                                                                                                                                                                        |

Check: 211 + 162 + 80 + 34 + 12 + 3 + 7 = 509.

`title-unread` is in 242 of 509 (B1 + B2), `slots0` in 211 (A). Together 453, 89% of the refusals.

## What the popup's field table adds (slot 0, 500 popup variations)

- The `title` field of slot 0: 112 variations with a known title line, 672 readings, 513 do not parse, 159 are blank,
  none equals the expected title (0 correct). The re-read of that line (the dimmed column of the popup) never gives a title
  of the pack; the line is found by the lines pass, so the refusal is the read, not the anchoring. 105 variations have
  no line and an unexplained band (`title-unseen`), 26 a garbled line above the name (`title-garbled`): both refuse.
- The column lifted as #104 did (`lift-*`): name and level settle on the expected value in 39 of 42 and 32 of 42, the
  title in 9 of 35. The title is the blocker, as the batch-4 note says.
- `level` and `name` of slot 0 read well when the card is anchored (225 of 243 and 176 of 243 settle on expected), so C and
  D are small and the lost variations are in A and B.

## Verdict for a change

- A (slots0) is a dimmed column the plain reading does not find a level line in; the only lever is the lifted read, which
  gained 53 correct and cost 3 wrong (reverted, spec Decisions). No rule of `find_cards` refuses a readable card: the
  level word and level are required by CHR-06.
- B refuses on a title nobody reads (0 correct of 112). Relaxing it is the unsafe direction: an unread title read as "no
  title" puts a hardcore card on the softcore ladder (`title=None` wrong).
- C and D1 are 46 variations whose readings do not agree; the rule is the zero-wrong rule.

No class shows a rule that refuses a readable card, so this batch makes no change to a reading module.
