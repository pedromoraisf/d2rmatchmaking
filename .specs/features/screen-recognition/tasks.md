# Screen recognition — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-screen-recognition` → `phase/F2`

Paths below are relative to `apps/agent/src-tauri` unless they start with `apps/`, `scripts/` or `tests/`. `CARGO` stands
for `cargo … --manifest-path apps/agent/src-tauri/Cargo.toml`.

In a fresh checkout run `pnpm install --frozen-lockfile` and `pnpm --filter @d2rmm/agent build` once before the first
gate that runs `cargo clippy` (the app crate needs `apps/agent/dist`; lessons).

## Rule 14 for this feature (AGENTS.md; `scripts/agent/reading-modules.json`)

Every task marked **[R14]** changes a non-test line of a reading module (`anchors.rs`, `character_screen.rs`, `layout.rs`,
`language.rs`, `party.rs`, `screen_reader.rs`, and the new `hud_track.rs` once listed). For each one, the worker:

1. writes the **pinning tests first**, in their own commit or their first step: they pin today's behaviour at the point
   about to change (screen order in `read_screen`, the boxes of `layout`, the Party results at 1033, the selection and
   popup reads of the committed fixtures), with values already documented as measured or with drawn fixtures, and they pass
   on the unchanged code before the change;
2. changes the reading logic only after that, in a separate commit step of the same task;
3. leaves the **real-print proof** to CI: `ocr-real` green (all twelve prints once T1 is in) and `ocr-variations` not
   regressing on its ratchet. The worker pushes, the orchestrator reads the run and writes the before and after counts
   into the PR description. A red `ocr-real` or a worse count is a failed gate: fix the cause, never the print list, the
   baseline or the expectation. Raising the ratchet's floor or lowering its ceiling is the maintainer's call (rule 4).

Fixtures are drawn by `xtask` (`cargo run -p xtask -- draw-fixture …`) and committed; a real print is never extracted,
copied or committed. On the maintainer's Mac a real print is read from its local path by an `xtask` command that prints
geometry and counts only. Windows OCR runs only in CI (`ocr-real`, `ocr-variations`, on pull requests that touch
`apps/agent`), so the worker cannot run it: it pushes and reads the result from the orchestrator.

**Gate prompts.** The gate hook asks the maintainer before an edit to `scripts/agent/reading-modules.json`,
`apps/agent/src-tauri/.cargo/mutants.toml` and `.quality-baseline.json` (OCP-08, AGENTS.md rule 4). No worker task edits
them. The one edit this feature needs, adding `domain/src/hud_track.rs` to the reading modules, is the orchestrator's
(Orchestrator section) and the maintainer answers the prompt. A worker whose task seems to need one of those files stops
and returns the task.

**Mutation never appears in a gate** (ADR 029). The nightly dispatched on the branch lists any survivor in the new
reading code; each is killed by a pinning test or excluded with evidence as `ocr-protection` defines.

## Batch 1 — runs in the cloud, no maintainer input

- [x] T1 — Take PR #87 in: `git merge origin/chore/F2-real-prints-generated-names` (two commits, one encrypted zip with the
      twelve prints). Do not open the zip. Expected: the merge adds only `apps/agent/ocr-lab/real-prints.zip` and the print
      names. `ocr-real` stays red on six Party prints until T6; that is the starting point of SCR-04. Gate:
      `node scripts/check-encrypted-zip.mjs && pnpm test:harness`
- [x] T2 — **Pin today's behaviour first (tests only, SCR-06).** In `domain/src/character_screen.rs`, `anchors.rs` and
      `layout.rs` add tests that pass on the unchanged code: the order of `read_screen` (automap, fixed Life, list marker,
      popup), `Unknown` for an unsupported size and for text that is none of them, the Party anchors found at 1920×1033
      with the committed measured lines, the fixed boxes of `Life` and `AreaDifficulty` at 1920×1033 and 1920×1080, and
      `find_party` finding nothing for a panel placed outside its area (the behaviour T6 changes; T6 replaces that
      test's expectation with the reason in its commit, as the maintainer's rule for a specified change). No non-test
      line changes, and no test is ignored. Gate:
      `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core --lib` and
      `CARGO clippy --all-targets -- -D warnings`
- [x] T3 — **[R14]** Resume item a from `origin/feat/agent-ingame-band-search` (SCR-01, SCR-02). Cherry-pick `4e190ad`
      and `9d6f963` (`hud_track.rs`, `ScreenRegion::HudBand`, `find_hud`, the `Mana:` word in `language.rs` and
      `resources/lang/en.json`, the core reader's tracker). Read both diffs line by line first: the fixed "Life:" box stays
      the first check, the band is read only without the list marker, and a tracked miss searches the band again.
      Finish what `9d6f963` left open (its tests must pass; the work-in-progress state is not trusted), fix clippy, and add
      the missing cases: a band find at 1920×1033, 1920×1045, 1920×1056 and 1920×1080; the English pack's
      words only; a tracker find at one client size never reused at another. Gate: as T2, plus
      `CARGO nextest run -p d2rmm-agent-core --lib` run under `cargo test -p d2rmm-agent-core --lib` too (one process, OCP-04)
- [x] T4 — **[R14]** The automap by words in a wide area, with the same search-then-track rule (SCR-03). Generalise
      `hud_track.rs` to a `Tracker` that both lines use (pure; no I/O), add the automap area to `layout.rs`, `find_automap`
      to `anchors.rs`, and the order of `read_screen`. The fixed `AreaDifficulty` box stays as the first check. Pinning
      tests of T2 first. Gate: as T3
- [x] T5 — Drawn fixtures per mode (SCR-07, SCR-01, SCR-03, SCR-08). Extend the `xtask` drawing
      (`xtask/src/character_fixture.rs` or a new `xtask/src/screen_fixture.rs`, wired in `main.rs`) with sidecars of lines
      that have boxes, at the HUD positions measured on the maintainer's prints: `in-game-window` (1920×1056),
      `in-game-fullscreen` (1920×1080), `in-game-mana-only`, `in-game-low-brightness`, `automap-window`,
      `automap-fullscreen`, `bottom-text-only`, `in-game-unsupported-size` (1280×1024) and `select-with-hud-text` (the
      selection screen with "Life:" text in the band, which must stay `Character selection`). Draw with the repository's
      open font, never from a print. Gate:
      `CARGO run -p xtask -- draw-fixture characters && git diff --exit-code apps/agent/fixtures && CARGO nextest run -p xtask --lib`
      (the drawing is deterministic: a second run changes nothing; commit the new files first, then the gate)
- [x] T6 — **[R14]** The Party panel found at every supported client height (SCR-04). Pinning tests first (T2's ignored
      case becomes the target). Widen the area `find_party` searches (`PanelRegion::PartyPanel` in `layout.rs`, a band like
      the HUD's if the 1920×1045 measurement shows the panel moves in y, never a larger fixed box guessed once), keeping the
      title, label and field rules as they are and the zero-wrong-confirmation rule (`game_name_match.rs` is not
      touched). Add unit tests at 1033, 1045, 1056 and 1080 with drawn lines at positions measured on the prints (the
      measurement comes from the orchestrator's note in the PR on the Mac: `xtask` geometry, counts only). Gate: as T3.
      Real-print proof: the PR's `ocr-real` green on all twelve prints, and `ocr-variations` not worse
- [x] T7 — Acceptance steps for the `@SCR-` scenarios (every step already exists in `characters-reading.steps.ts`, so the task
      only makes the fixture lookup find `apps/agent/fixtures/screens`; no new steps file), reusing the
      `characters-reading` steps (consent, "the game shows the fixture", "the site shows the agent's screen as") and the
      headless agent with a fixture sidecar. Never edit `acceptance.feature`. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @SCR-` and `node scripts/acceptance-check.mjs screen-recognition`

## Batch 2 — reading proofs on the real prints (CI loop; the orchestrator reads each `ocr-real` and `ocr-variations` run)

- [x] T8 — **[R14]** Telemetry (SCR-09, brief input 6). Add `vision.screen`, `vision.search` and `vision.area_class` to a
      new `agent.vision.read` span inside `ScreenReader::read`, with fixed words and no coordinates, text or pixels (no
      counter: the agent has no metrics pipeline, the orchestrator's decision), and allow the three keys, with their fixed
      values only, in the exporter's sanitiser. Existing span tests gain assertions, never lose one. A source-rule test in
      `scripts/test/` refuses a read text or a region in a span attribute of the vision code. Gate:
      `CARGO nextest run -p d2rmm-agent-core --lib && pnpm test:harness`
- [ ] T9 — **[R14]** Popups with no card read (item f, SCR-05). From the PR's `ocr-variations` summary, list the refusal
      reasons of the 176 popup variations (reason classes only; the summary prints no read text), pin the reads that
      work, then change the popup logic only where a reason class shows a rule that refuses a readable popup. One change
      per commit, each pushed and proved: `ocr-real` green, `popup` correct count up, `wrong` not up. Gate: as T3
      Moved out of this PR (#104 fix round 2): the popup column lift (7d53fe17, `CardColumnLifted`, `lift_dimmed`) is
      reverted. It gained 53 correct (2356 to 2409) but cost 3 wrong (43 to 46, ceiling 43), see the spec Decisions. It can
      come back together with a stricter lifted read.
      Part 3 attempt 1 (#120, run 44873170168): the lift came back with every field required unanimous across variants. The
      lift ran (102 of the popup print's 500 variations changed reason, `slots0` fell from 173 to 71) but no variation became
      correct: every one now refuses on `name-unread`, `level-unread` or `title-unread` (counts 2365/2810/45, popup 61/430/9,
      identical to the baseline). The old lift's gain was 45 correct for one new wrong (`card1-level=1`, combo-154); the JSON
      holds no readings, so no rule between majority and unanimity can be shown to refuse that one wrong and keep the gains.
      Reverted. A later attempt needs the field readings of those variations (a local diagnostic), not a guess.
      Part 3 attempt 2 (batch 4, PR #132, run 44948588412): no code change; the diagnostic the note asked for. `ocr-variations`
      now counts, for the popup print, per card slot and field, how the OCR variants agree (counts only, no text), and, for the
      173 variations that read no card (`slots0`), the same on the column lifted as #104 did (every third variation, 42 read).
      What it shows (popup print, 500 variations, 61 correct, 430 refused, 9 wrong, unchanged): (1) of those 42 lifted reads the
      majority rule settles both cards' name and level on the expected values in 25 and on a wrong value in 1 (the #104 wrong:
      a level read as `1` for `11`); only 4 are unanimous on all four fields. (2) The title is the blocker: the lifted title
      line settles on the expected title in 9 of 40 and on another value in 7 (a blank line settling as "no title", the
      `title=None` wrong), and the plain read's known title line (112 slot-0 variations) never reads the expected title. A rule
      that keeps name and level by majority and requires the title read as production does gains at most the 9 whose title
      reads, about 3 per 10 of the 173, with the 1 wrong still possible unless every name and level field is unanimous (4 of 42,
      so a gain of a handful). That is not worth a new `ScreenRegion`, a frame copy and a second column read in a reading
      module, so nothing is changed and the box stays open. The class that remains is `title-unread` on a dimmed title line.
- [x] T10 — **[R14]** Unrecognised selection screens (item f, SCR-05). Same loop as T9 for the 104 screens read as
      `Unknown`: classes of reason first, then the smallest change per class (the list marker searched by its word in a
      wider area, as the HUD is). A frame that is not the selection screen must still read `Unknown` (the drawn
      `select-with-hud-text` and `bottom-text-only` fixtures). Gate: as T3
      _Part 2 (code and unit proofs): `ScreenRegion::CreateNewArea`, `find_create_new`, a tracker of the marker in the core
      reader, searched every second frame while not found; the pins and the call-count tests are in `domain` and `core`.
      The real-print proof (`not-the-select-screen`, 107 variations of run 44751561205) waits for the PR's `ocr-variations`._
- [x] T11 — Close the proofs (SCR-06, SCR-05). Write the PR's table: `ocr-real` per print (12), `ocr-variations` counts
      before (`phase/F2` baseline) and after, and the share of selection and popup variations correct. If the supported
      selection or popup share is under 95%, say which reason classes remain and stop: tuning on the maintainer's new
      prints is a later batch. Propose a ratchet move to the maintainer in the PR; never edit `.quality-baseline.json`.
      Gate: `pnpm specs:check && pnpm test:harness`

## Orchestrator (local, the maintainer answers the gate)

- [ ] O1 — After T3 merges into the branch: add `domain/src/hud_track.rs` to `scripts/agent/reading-modules.json`
      (`examine_globs` already covers `domain/src/**`). The gate asks; the maintainer answers. Gate:
      `pnpm test:harness`
- [ ] O2 — For T6: measure the Party panel's lines on the six 1920×1045 prints with an `xtask` geometry command run on
      the Mac against the local path of the prints (counts and pixel boxes, never a pixel written to the repository),
      and put the numbers in the PR for the worker. If the Mac cannot read the prints, the first `ocr-real` diagnostics
      give the same geometry.

## Batch 3 — waits for the maintainer's field matrix (brief input 8d)

These wait; nothing in batches 1 and 2 depends on them.

- [ ] T12 — Field matrix on the agent built from this branch (the per-PR test installer): windowed, borderless and full
      screen; legacy graphics (G); low and high brightness; the screen shown by the site in each. The maintainer's log is
      the proof (SCR-07). Needs the maintainer's PC.
- [ ] T13 — **[R14]** Fix what the matrix shows: for each mode that reads wrongly, a drawn fixture first (as T5), then the
      change, then the real-print proof. If the matrix brings new real prints, they join the encrypted zip by the
      maintainer's hand (`apps/agent/ocr-lab/README.md`). Gate: as T3
- [ ] T14 — CPU over a 30-minute field session below 2% with the tracker on, from the agent's CPU telemetry, and no FPS
      drop the maintainer can notice (NFR-02, SCR-02). Needs the maintainer's PC.

## Batch 7 (CPU of the pt-BR fallback)

Measures what the pt-BR fallback pack costs in CPU (NFR-02, brief exit criterion "Performance") without changing a
non-test line of a reading module (rule 14). Estimate: `cpu-fallback.md`.

- [x] T15 — Pin the OCR passes per frame (test lines only): an English client in steady state (selection, HUD, automap), a
      pt-BR client in steady state (the first frame pays both packs, then one), and frames `Unknown` in both languages (a
      menu, an empty frame, a desktop window), over 600 frames: every frame pays both packs and the cost never settles.
      The Party panel and the chat make no second OCR pass for the fallback. Gate:
      `cargo nextest run -p d2rmm-agent-core --lib` in `apps/agent/src-tauri`
- [x] T16 — Estimate the cost of the fallback (`cpu-fallback.md`): scenario × passes per frame × engine calls per pass ×
      share of the 2% budget, with the source of each number and the assumed time per call labelled. Result: the
      `Unknown`-in-both case pays two passes every frame (72 engine calls a frame on average, 36 of them the fallback) and
      exceeds half the budget. Gate: `pnpm format:check && pnpm specs:check`
- [ ] T17 — **[R14]** Guard the second pack: skip the pt-BR (or English) pass when the first found no anchor at all, so an
      `Unknown` frame pays one pass instead of two. Changes a non-test line of `core/src/screen_reader.rs`: **rule 14 —
      needs ocr-real proof** (`ocr-real` and `ocr-variations` green, the ratchet not regressing, before and after counts
      in the PR). Pin the current behaviour first (T15's tests), not implemented in this batch. Gate: as T3
