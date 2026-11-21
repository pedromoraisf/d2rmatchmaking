# Game name reading — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-game-name-reading` → `phase/F2`

Paths below are relative to `apps/agent/src-tauri` unless they start with `apps/`, `scripts/` or `tests/`. `CARGO` stands
for `cargo … --manifest-path apps/agent/src-tauri/Cargo.toml`.

In a fresh checkout run `pnpm install --frozen-lockfile` and `pnpm --filter @d2rmm/agent build` once before the first
gate that runs `cargo clippy` on the app crate (it needs `apps/agent/dist`; lessons).

**Starts after `screen-recognition` batch 1 is merged into `phase/F2`** (it takes PR #87 in and makes the Party panel
found at every client height). T1 merges that state in. This feature never changes the area, boxes, title or label rules
of `find_party` or `PanelRegion::PartyPanel`.

## Rule 14 for this feature (AGENTS.md; `scripts/agent/reading-modules.json`)

Every task marked **[R14]** changes a non-test line of a reading module (`game_name_match.rs`, `anchors.rs`, `layout.rs`,
`language.rs`, `party.rs`, `screen_reader.rs`, and the new `chat.rs`, `automap_name.rs` and `chat_step.rs` once listed).
For each one, the worker:

1. writes the **pinning tests first**, in their own commit or their first step: they pin today's behaviour at the point
   about to change (what `read_field` and `normalise` accept and refuse, what `read_panel_field` returns per source, the
   Party reads of the committed fixtures), with values already documented as measured or with drawn fixtures, and they
   pass on the unchanged code before the change;
2. changes the reading logic only after that, in a separate commit step of the same task;
3. leaves the **real-print proof** to CI: `ocr-real` green (every print of the zip) and `ocr-variations` not regressing on
   its ratchet. The worker pushes; the orchestrator reads the run and writes the before and after counts into the PR
   description. A red `ocr-real` or a worse count is a failed gate: fix the cause, never the print list, the baseline or
   the expectation. Moving the ratchet's floor or ceiling is the maintainer's call (rule 4).

Fixtures are drawn by `xtask` (`cargo run -p xtask -- draw-fixture …`) and committed; a real print is never extracted,
copied or committed. Windows OCR runs only in CI (`ocr-real`, `ocr-variations`, on pull requests that touch
`apps/agent`), so the worker cannot run it: it pushes and reads the result from the orchestrator. The CI log and the
variations summary hold counts, outcome classes, reason classes and edit operations against a generated name; no player
name. A worker never asks for or prints `--show-reads`.

**Gate prompts.** The gate hook asks the maintainer before an edit to `scripts/agent/reading-modules.json`,
`apps/agent/src-tauri/.cargo/mutants.toml` and `.quality-baseline.json`. No worker task edits them. The edit this feature
needs, adding `chat.rs`, `automap_name.rs` and `chat_step.rs` to the reading modules, is the orchestrator's (O2). A worker
whose task seems to need one of those files stops and returns the task.

**Mutation never appears in a gate** (ADR 029). The nightly dispatched on the branch lists any survivor in the new
reading code; each is killed by a pinning test or excluded with evidence as `ocr-protection` defines.

**Chat and player names.** The chat lines of a drawn fixture use made-up names ("Bob"). No test, log line, span or
failure message carries a name read from a real print.

## Batch 1 — runs in the cloud, no maintainer input; T4 to T7 wait for O1's note

- [x] T1 — Take `screen-recognition` in: `git merge origin/phase/F2` once its batch 1 is there (it brings PR #87's
      `real-prints.zip`). Do not open the zip; do not edit `find_party`, `PanelRegion::PartyPanel` or the panel's
      anchors. Expected: only the merge. Gate: `node scripts/check-encrypted-zip.mjs && pnpm test:harness` and
      `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core --lib`
- [x] T2 — **Pin today's behaviour first (tests only, GNR-02, GNR-03, GNR-04).** In `domain/src/game_name_match.rs`,
      `domain/src/fusion.rs` and `core/src/party.rs` add tests that pass on the unchanged code: every glyph of the
      table in each part of the name (letters before the last `-`, digits after it) and one name it must not match; `n`
      read against an `m` room and `m` against `n` stay `Other`; `read_panel_field` per `FieldSource`; the seven
      generated names of PR #87 normalise to distinct forms and equal themselves under every glyph of the `⊕` family; the
      observation of `fuse` for a matched, a masked and another name. Name the real-print read in the comment only where
      the file already documents it as measured. No non-test line changes, and no test is ignored. Gate:
      `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core --lib` and
      `CARGO clippy -p d2rmm-agent-domain -p d2rmm-agent-core --all-targets -- -D warnings`
- [x] T3 — **[R14]** The chat in the domain (GNR-07). Add `domain/src/chat.rs`: `ChatEvent { Joined, Left }`,
      `classify(pack, line) -> Option<(ChatEvent, name)>` by the pack's words, and `ChatTracker` (a line present in the
      previous frame is not new; a name that joins, leaves and joins again is three events; a blank name is ignored). Add
      the words `joinedGame` and `leftGame` to `LanguagePack` and `resources/lang/en.json`, **from O1's note only**
      (never a guess); Portuguese stays out until O1 gives its words (T10). Pure, no I/O. Gate: as T2
- [x] T4 — **[R14]** The automap name in the domain (GNR-06). Pinning tests of `layout.rs` and `anchors.rs` first (as T2).
      Then add `ScreenRegion::AutomapName`, a wide area at the top of the client resolved by the client size (numbers from
      O1's note, as a band and never one fixed box), and `anchors::find_name_line`: the first line whose normalised read
      parses as `mm` + letters + `-` + digits. Matching stays `game_name_match`'s. Unit tests at 1920×1033, 1920×1045,
      1920×1056 and 1920×1080 with drawn lines at the measured positions. Gate: as T2
- [x] T5 — Drawn fixtures (GNR-06, GNR-07, GNR-09). Extend the `xtask` drawing (a new `xtask/src/automap_name_fixture.rs`
      and `chat_fixture.rs`, wired in `main.rs` as `draw-fixture automap-name` and `draw-fixture chat`) with sidecars of lines
      that have boxes: the automap name for each difficulty code and activity, a name that is another room's, a chat
      joined line, a chat left line, the same line across frames, a Portuguese pair, and a line with no joined or left
      words. Use the repository's open font and made-up player names, never a print. Gate:
      `CARGO run -p xtask -- draw-fixture automap-name && CARGO run -p xtask -- draw-fixture chat && git diff --exit-code apps/agent/fixtures`
      and `CARGO nextest run -p xtask` (the drawing is deterministic: a second run changes nothing; commit the new files first,
      then run the gate)
- [x] T6 — **[R14]** The core steps (GNR-06, GNR-07, GNR-10). Add `core/src/automap_name.rs` (read the area while the
      Party step has not matched the run; match; post once through `post_observation`) and `core/src/chat_step.rs` (read the
      chat area, track new lines, count them as `joined` or `left`; it posts nothing), and call them
      from `watch_screen.rs` after the Party step, at most one frame a second. Telemetry as the design's table, with fixed
      words only. Unit tests with `fakes.rs`: a chat line posts no observation and sends no name; a run confirmed by the Party step is not posted
      again by the automap; a repeated line counts once; a failed post retries as F0's rules say; no span attribute, log
      line or label holds a name (a source-rule test in `scripts/test/` refuses it). Gate:
      `CARGO nextest run -p d2rmm-agent-core --lib` and `CARGO test -p d2rmm-agent-core --lib` (one process, OCP-04),
      `CARGO clippy -p d2rmm-agent-core --all-targets -- -D warnings` and `pnpm test:harness`
- [x] T7 — Acceptance steps for the `@GNR-` scenarios in `tests/acceptance/steps/game-name-reading.steps.ts`, reusing the
      `agent-game-name` steps (the test match, consent, "the room becomes Created within 2 seconds") and the headless agent
      with the T5 fixtures; the headless example reads the sidecar lines of the automap and chat fixtures. Never edit
      `acceptance.feature`. Gate: `pnpm exec turbo run test:acceptance -- --grep @GNR-` and
      `node scripts/acceptance-check.mjs game-name-reading`

## Batch 2 — reading proofs on the real prints (CI loop; the orchestrator reads each `ocr-real` and `ocr-variations` run)

- [x] T8 — The real-print check reads the automap and chat prints (GNR-11). In `src/ocr_check.rs` add the verdicts for the
      automap and chat files by the names O1 lists (the same shape as `party_expectation`: the expected generated name for
      an automap print; the expected event, and for a chat print only whether the name was read, never its text, for a chat
      print), `spots` for their diagnostics (counts and boxes only; a name region is personal and prints only with
      `--show-reads`), and `ocr_variations` counts them in its totals. The tests of this file gain assertions, never lose
      one. Gate: `CARGO nextest run -p d2rmm-agent --lib ocr_check` and `pnpm test:harness`. Real-print proof: the PR's
      `ocr-real` lists the new files as PASS or FAIL with a reason class, and `ocr-variations` totals include them
- [x] T9 — **[R14]** Refusals of the seven generated-name prints (item e, GNR-01, GNR-05). From the PR's `ocr-variations`
      summary, list the reason classes per print (the summary prints no player name; edit operations are against a generated
      name, which is public), pin the reads that work, then change the logic only where a class shows a rule that
      refuses a readable name. One change per commit, each pushed and proved: `ocr-real` green, the print's correct
      count up, `wrong` not up. A class that is a missed panel goes to `screen-recognition`; a class that is not in the frame
      stays refused and is written in the PR with its count. Gate: as T6
- [ ] T10 — **[R14]** Misread glyphs from observed reads (GNR-03, GNR-04, GNR-09). For each glyph the summaries show
      the engine returning for a letter or digit of a generated name (`sub(o>0)@9`-style operations name the pair), add it to
      the table for its part of the name only, with the unit test of the glyph, the unit test of the name it must not
      match, and the collision test over every activity, code and run number up to 9999 and the drift test green. A glyph
      with no observed read is never added; the `n` and `m` prints (`mmpvpn-10`, `mmbaalm-99`) are read in this task too.
      Gate: as T6
- [ ] T11 — **[R14]** Automap and chat refusals (GNR-06, GNR-07, GNR-11). Same loop as T9 on the automap and chat prints:
      classes of reason first, then the smallest change per class (the name line searched in a wider band, as the HUD is; the
      chat words of Portuguese added as data in `resources/lang/pt-BR.json` from O1's note). A frame with no joined or left
      line must still classify nothing (the drawn lines of T5). Gate: as T6
- [ ] T12 — Close the proofs (GNR-01, GNR-02, GNR-11). Write the PR's table: `ocr-real` per print, `ocr-variations` counts
      before (`phase/F2` baseline) and after, the share correct per generated-name print, and the wrong count of game names
      (must be 0). If the share on the seven prints is under 95%, say which reason classes remain and stop: tuning on the
      maintainer's new prints is a later batch. Propose a ratchet move to the maintainer in the PR; never edit
      `.quality-baseline.json`. Gate: `pnpm specs:check && pnpm test:harness`

## Orchestrator (local, the maintainer answers the gate)

- [x] O1 — Before T3: from the local path of the real prints on the Mac (`xtask` geometry command; counts and pixel boxes,
      never a pixel written to the repository), put in the PR for the worker: the file names of the automap and chat prints
      in `real-prints.zip` and what each expects (the game name; joined or left; English or Portuguese); the box of the
      name line on the automap at 1920×1033, 1920×1045 and 1920×1080; the chat area's box; and the fixed phrases of the
      joined and left messages in English and Portuguese (game text, not a player name). If the Mac cannot read the prints,
      the first `ocr-real` diagnostics give the geometry.
- [x] O2 — After T6 merges into the branch: add `domain/src/chat.rs`, `core/src/automap_name.rs` and
      `core/src/chat_step.rs` to `scripts/agent/reading-modules.json` (`examine_globs` already covers `domain/src/**` and
      `core/src/**`). The gate asks; the maintainer answers. Gate: `pnpm test:harness`

## Batch 3 — waits for the maintainer (brief input 8e)

These wait; nothing in batches 1 and 2 depends on them.

- [ ] T13 — Live normal and nightmare rooms on the agent built from this branch (the per-PR test installer): a room in
      each, the Party panel revealed, the automap open, a second player joining and leaving, and the site's "Confirmed by
      the agent" in each. The maintainer's log is the proof (GNR-09). Needs the maintainer's PC.
- [ ] T14 — The field log for the 95% rate (brief exit criterion 3): at least 20 rooms across normal, nightmare and hell,
      at least 95% reaching "Confirmed by the agent", from the agent's own log lines. Needs the maintainer's PC.
- [ ] T15 — **[R14]** Fix what the live rooms show: for each room that did not confirm, a drawn fixture first (as T5), then
      the change, then the real-print proof. If a live room brings a new print, it joins the encrypted zip by the
      maintainer's hand (`apps/agent/ocr-lab/README.md`). Gate: as T6

## O1 note

The real prints are already in the encrypted `apps/agent/ocr-lab/real-prints.zip` on `phase/F2`, and nobody on the Mac
decrypts it (the password is a CI secret). So O1's geometry (the automap name-line band, the chat area box) comes from the
first `ocr-real` diagnostics, and T8 (the check reads the automap and chat prints, with `spots` counts and pixel boxes
only) runs before T3 to T7. The expectations are in the file names:

- `maintainer-automap-en-mmbaalh-19.png` (English client, automap shows `mmbaalh-19`)
- `maintainer-automap-pt-mmchaosh-20.png` (Portuguese client, `mmchaosh-20`)
- `maintainer-chat-en-mmbaalh-19.png` (English chat; the event class is confirmed from the CI verdict, not guessed)
- `maintainer-chat-pt-joined-closed-1.png`, `maintainer-chat-pt-joined-open-1.png` (Portuguese, joined; chat panel
  closed and open)
- `maintainer-chat-pt-left-closed-1.png`, `maintainer-chat-pt-left-open-1.png` (Portuguese, left)

Chat phrases are never guessed into the product. T8's diagnostics test candidate phrases and print one boolean per
candidate, never the text read. A candidate becomes product data (T3, T11) only after CI shows it found on the matching
print.

### O1 result (orchestrator note on PR #107, from the first `ocr-real` run, job 136538900128)

`ocr-real`: 17 of 19 PASS. All 12 earlier prints PASS; the EN automap and the 4 PT chat prints PASS on the first try.

**Automap name line (GNR-06).** The name sits in the top-right text column, on one line with its label and a colon:
`<label>: <name>` (the label differs in PT). Measured boxes of that line:

| print      | client    | box (x, y, w, h)                |
| ---------- | --------- | ------------------------------- |
| EN automap | 1920×1033 | 1735–1738, 34–35, 155×11–13     |
| PT automap | 1920×1045 | 1728–1731, 46–47, 164–166×14–15 |

In one PT variant the line sits at y 83 (scale variant). The column's lines run from x ≈ 1690 to the right edge, at
y ≈ 15–110. Band for T4: from x = 85% of the width to the right edge, y = 0 to 12% of the height, resolved by client size,
a band and never one box. The PT print fails today because the label and colon stay glued to the name
(`aaaa: aaaaaaaa-9a`); in 2 of 6 EN variants the line split alone. So `find_name_line` must look at the text after the last
`:` or `;` of a line, or at its last token, as well as at the whole line. In PT the digits read as `9a` in several
variants: that is T10's glyph table (observed reads only), not a guess.

**Chat area and phrases (GNR-07).** Phrase lines sit at x ≈ 24–26 and y ≈ 590–790, widths up to about 530 (1920×1033:
lines at y 656 and 770; 1920×1045: y 592, 668 and 744). Chat band for T3/T6: x = 0 to 30% of the width, y = 50% to 80% of
the height. Phrases confirmed by CI: EN joined `joined our world`, EN left `left our world`, PT joined
`entrou em nosso mundo`, PT left `saiu de nosso mundo`. Candidates `entrou no nosso mundo` and `saiu do nosso mundo` were not
found and never become data. A name is read before the phrase on every chat print.

The EN chat print `maintainer-chat-en-mmbaalh-19.png` holds one joined and one left line, so its class is `both`; its file
name names no event, so T8's verdict for a print that names no event accepts `both` (a test-expectation fix, not a reading
change).
