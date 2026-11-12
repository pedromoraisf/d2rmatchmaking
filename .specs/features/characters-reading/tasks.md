# Characters read from the screen — Tasks

Spec: `spec.md` · Design: `../characters/design.md` (Agent rows) · Branch: `feat/F1-characters-reading` → `phase/F1`,
created from `phase/F1` once `characters` has merged. Starts when the screenshots are in
`apps/agent/fixtures/characters/`.

## Batch 1

- [x] T1 — Reading regions relative to the client size (CHR-19), the screen classifier (CHR-04), the card parser
      (CHR-06: title, name, "Level N Class", hardcore by red name; CHR-08: English and Portuguese dictionaries, diacritic-insensitive) and the difficulty popup (CHR-18), unit tests on the sidecar text of
      every fixture — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib && cargo nextest run -p d2rmm-agent-core --lib`
- [x] T2 — Fixtures and OCR: `xtask draw-fixture characters` draws the selection screen (titled, untitled, hardcore
      title, a full list), the difficulty popup, in game, automap and menu, with JSON sidecars; a Windows test reads the
      drawn fixtures with Windows OCR (CI's Windows job); `scripts/agent/ocr-check.mjs` gains the maintainer's
      selection-screen and popup screenshots (read from the folder it is given, never committed) — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p xtask && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [x] T3 — Headless example: `--consent`, stdin `consent on|off` and `show <png>`, sidecar `<png>.json` per region;
      acceptance steps for every step of `acceptance.feature` — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@CHR-(04|06|18|20)"`
- [x] T4 — Whole-repo sensors — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`

## Batch 2 — review fixes (PR #50)

- [x] T5 — Restore agent-game-name's "has capture consent" step exactly as merged (its `expect(room)` and the
      unconditional assignment wait; architecture review finding 1, rule 3) and give characters-reading its own step
      "has capture consent and no room" sharing the setup through a helper — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@AGN-|@CHR-"`
- [x] T6 — Popup safety (finding 2): a difficulty counts as enabled only when its label reads and the label's pixels
      are as bright as an enabled label (threshold measured on the maintainer's popup screenshot); `xtask` draws a
      popup fixture with Nightmare and Hell disabled (dimmed), and the Windows OCR test and a domain unit test prove it
      reads Normal only — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p xtask && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [x] T7 — Name reconciliation (finding 3): a read name that equals a character the agent already posted for this
      account when `I`/`l`/`1` are treated as one glyph (and `0`/`o`) keeps the stored spelling; spec decision recorded;
      core unit tests — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib`
- [x] T8 — Loop cost (security low 3): the card regions are read only when the screen classified as character
      selection, and the frame's OCR runs through `tokio::task::spawn_blocking` as the Party step does; core unit tests
      — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib && cargo nextest run -p d2rmm-agent-adapters`
- [ ] T9 — Windows OCR reads the screen markers (CI run 42973374788): the Windows fixture test prints, for every
      fixture, what each marker and popup region read; then fix the cause it shows (region boxes too tight for the
      glyphs, drawn font too small against the 1033 proportions, or OCR scale) and prove it on the PR's Windows job —
      gate: the PR's `agent` job green

## Batch 3 — the maintainer's standalone OCR check

- [x] T10 — Standalone Windows OCR check: `ocr-check.exe <folder>` (cargo example `ocr-check`, examples/ocr-check.rs) reads
      the five screenshots of `scripts/agent/ocr-check.mjs` with the production reader and the same shared code as the
      `ocr_check` test (`d2rmm_agent::ocr_check::check_folder`, the crate now also a library), prints PASS or FAIL per
      file, names missing files, says when the en-US OCR language is not installed, exits non-zero on any failure; CI
      `agent-build` builds it with static CRT and uploads `ocr-check-windows` (14 days); the README lists the no-install path first and the Node path second —
      gate: `cd apps/agent/src-tauri && cargo build --example ocr-check && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs` and `pnpm test:harness`

## Batch 4 — the maintainer's Windows evidence (2026-11-11)

The maintainer ran `ocr-check.exe` on the real screenshots: the Party regions are right, but the game's small caps come back
as mixed case with spaces ("GA m E N A me"), the field reads "OUEL NK LBCKS" for "DUEL NK LOCKS", and the select-screen
regions read nothing (the tool printed no raw text for them).

- [x] T11 — Smooth upscale before OCR: the shared `scaled_bgra` (used by the agent and by `ocr-check`) enlarges every
      crop 3× with bilinear interpolation (integer weights, clamped to the region) instead of repeating pixels; unit
      tests on dimensions, boundaries and interpolated pixels —
      gate: `cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [x] T12 — Small-caps tolerant Party matching: the label matches "GAME NAME" ignoring case and all whitespace; the panel
      is open when the title is the pack's title or a prefix of at least 3 letters (a tooltip leaves "PAR") — the Party step
      reads the title alone, as before — or, for the check tool, when the label matches; the field compare is unchanged
      (exact after normalisation: "OUEL NK LBCKS" is refused, masked stays masked) —
      gate: same as T11
- [x] T13 — Diagnostics in `ocr-check`: per file, the image size and, per reading region (Party title/label/field,
      select-screen card name, class/level line and title line, difficulty popup labels), the pixel rectangle and the raw
      OCR text, before the PASS/FAIL line; what counts as PASS is unchanged —
      gate: `cd apps/agent/src-tauri && cargo build --example ocr-check && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs` and `pnpm test:harness`
- [x] T14 — Production back to nearest 3× (the reading that read the drawn fixtures; T11's bilinear blur lost them in CI):
      `Upscale::{Nearest, Bilinear}` in `ocr_pixels`, bilinear kept and unit-tested but unused by the agent; `ocr-check`
      prints, for every region, the raw text of nearest 3×, bilinear 3×, nearest 4× and bilinear 4× (PASS/FAIL from the
      production reader only); one shared panel-open rule (`LanguagePack::party_panel_open`, the title or 3+ letters of
      it) for the agent and the tool —
      gate: `cd apps/agent/src-tauri && cargo build --example ocr-check && cargo nextest run && cargo clippy --all-targets -- -D warnings` and `pnpm test:harness` (win-check by CI's Windows clippy)
- [x] T15 — Encryption sensor `scripts/check-encrypted-zip.mjs` (+ Lefthook `ocr-lab`, harness test): only an AES-256 encrypted zip and a README under `apps/agent/ocr-lab/` —
      gate: `pnpm test:harness`
- [x] T16 — Workflow `.github/workflows/ocr-real.yml` (Windows, same-repo PRs only, secret on the extract step only, cleanup always) + static harness test —
      gate: `pnpm test:harness`
- [x] T17 — Docs: `apps/agent/ocr-lab/README.md`, `apps/agent/README.md` (CI path first), `decisions.md` row —
      gate: `pnpm format:check && pnpm specs:check`
- [ ] T18 — With `real-prints.zip` in place, push and report the `ocr-real` job's full output (evidence for the next fix round) —
      gate: PR #50's `ocr-real` job ran

## Batch 5 — parsing tolerant to the real reads (first `ocr-real` run, 2026-11-12)

The regions are right on the maintainer's real screenshots; the engine's raw reads are noisy ("LEWEL II SBRCERESS",
"m ATRIARCH", "NeRrnAL", "OUEL NK LBCKS" against "DUEL NK LOCKS"), so the parsing must read a closed vocabulary and
combine several readings.

- [x] T19 — Closed-vocabulary matching in the domain (`vocabulary.rs`): uppercase, drop spaces and punctuation, try the
      "RN"/"RT"/"RF" → "M" collapses as extra candidates, then the unique nearest vocabulary entry by edit distance
      (0 for words of 3 letters or fewer, 1 up to 5, 2 beyond); a tie or nothing within the threshold is unknown.
      The language pack supplies the vocabularies (classes, titles, "Level", the three difficulties); unit tests with
      the real reads and the near-misses that must be refused —
      gate: `cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings`
- [x] T20 — Numbers: the level token with the digit confusion map (I/l/| → 1, O/D/Q → 0, B → 8, S → 5, Z → 2, G → 6),
      range 1..=99, anything else unknown; unit tests ("88", "8B", "II", "1I", "B8", "100", "") — same gate
- [x] T21 — Several readings per region: `TextReader::read_variants` (default: the one reading); Windows OCR reads
      nearest 3x, bilinear 3x, nearest 4x and bilinear 4x (the real reads: the field matches only in bilinear 3x, the
      popup's Normal only in bilinear 4x, a name pair agrees only at 4x); the game-name field is Matched if any variant
      matches exactly, Masked if any is the mask; names, class/level and titles by majority of agreeing variants (a
      single-reading reader keeps its reading); the difficulty popup is recognised by 2 of 3 difficulty labels —
      same gate
- [x] T22 — Names are compared case-insensitively (the game draws names in small caps): `glyph_key`/`reconcile_names`
      and `ocr_check`'s expectation; recorded in `phases/F1/decisions.md → To confirm` — same gate
- [ ] T23 — Real proof: push and read the PR's `ocr-real` job ("0 of 5 files FAIL") and the `agent` job

## Batch 6 — agreement across more readings and drawn fixtures in the game's lettering (`ocr-real` run 43213637656, 2026-11-12)

The real screenshots read 4 of 5: the selection screen's first name reads "VI-JK VUKA" and "i vuKVUKA" in the four
readings, a one-to-one tie that is refused; the 5x readings read "VUKVUKA" again. The drawn fixtures read empty
levels and popup labels because their lettering is not the game's.

- [ ] T24 — Six readings per region (nearest and bilinear at 3x, 4x, 5x). A character name settles only when at least
      two readings agree and outnumber every rival reading (a single-reading reader keeps its reading); the
      single-distinct-name fallback goes. Unit tests with the exact reads of `maintainer-select-screen.png` and
      `maintainer-select-difficulty.png` (both cards), and a tie that stays unknown —
      gate: `cargo nextest run` and `cargo clippy --all-targets -- -D warnings`
- [ ] T25 — The drawn fixtures imitate the game's lettering: upper-case small caps, bold, sizes and inks close to the
      real screenshots ("LEVEL 88 SORCERESS", "MATRIARCH", "SELECT DIFFICULTY", "NORMAL" / "NIGHTMARE" / "HELL", the
      Life label, the automap's area difficulty); regenerated with the xtask; every expectation unchanged — same gate,
      plus `node scripts/check-images.mjs`
- [ ] T26 — `phases/F1/decisions.md → To confirm`: names compared without case (T22) and the agreement rule (T24) —
      gate: `pnpm specs:check` and `pnpm format:check`
- [ ] T27 — Real proof: the PR's `ocr-real` job prints "0 of 5 files FAIL" and the `agent` job is green
