# OCR protection — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-ocr-protection` → `phase/F2`

Placement (no design.md, Medium).

**What this feature changes**:

- tests in the reading modules' `#[cfg(test)]` modules;
- `apps/agent/src-tauri/.cargo/mutants.toml`;
- `scripts/agent/reading-modules.json` (new) and the harness tests in `scripts/test/`;
- AGENTS.md, `.claude/agents/feature-worker.md` and `.claude/skills/d2rmm-phase-runner/SKILL.md`.

**What it never changes**: any non-test line of a reading module (OCP-05). If a survivor seems to need one, stop and
return the task.

**Known survivors** (nightly 44558970584, all in domain; line numbers are on 570b7b5, and only `game_name_match.rs` has
changed since):

| File                  | Count | Lines and functions                                                                                                                |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `anchors.rs`          | 3     | 182 (`find_cards_in_variants`), 247 (`is_popup_title`)                                                                             |
| `character_screen.rs` | 10    | 86 (`is_gold`), 106 (`label_brightness`), 246, 273 and 293 (`read_screen`), 344 (`popup_difficulties`), 579 and 585 (`read_level`) |
| `characters.rs`       | 1     | 247 (`is_character_name`)                                                                                                          |
| `layout.rs`           | 9     | 49, 65 and 66 (`PanelBox::resolve`), 108 (`supported_size`), 179 (`screen_box`), 204 (`selection_band`)                            |
| `name_diff.rs`        | 15    | plus one timeout at line 83                                                                                                        |
| `vocabulary.rs`       | 7     | lines 23–28 and 99                                                                                                                 |
| `vision.rs`           | 6     | 21 (`Region::middle_x`)                                                                                                            |

Read the exact mutants from the run's `agent-mutation` artifact (`gh run download 44558970584 -n agent-mutation`, into a
new empty directory). Pin values with the constants already documented as measured on the maintainer's prints, or
with drawn fixtures. Never commit a capture.

## Batch 1

- [ ] T1 — Make the core's unit tests pass in one process (OCP-04). The span tests install a thread-local subscriber
      while other threads register the same callsites. Fix the test setup, for example by rebuilding the interest cache
      after `set_default` or by serialising the span tests; never change the reading code or an assertion. Gate:
      `cargo test --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib`
- [ ] T2 — Add `scripts/agent/reading-modules.json` (OCP-02). Add `core/src/party.rs` and `core/src/screen_reader.rs`
      to `examine_globs` (OCP-03). Write a harness test that every listed module exists and is in the scope, with a
      negative fixture. Update the lists in `agent-mutation-scope.test.mjs` and `agent-source-rules.test.mjs`. Gate:
      `pnpm test:harness`
- [ ] T3 — Write the exclusion evidence check (OCP-06): each `exclude_re` entry needs a preceding comment with
      `file:line`, the reason and an `Evidence:` line. Add the missing `Evidence:` line to the existing `pair_once`
      entry, quoting its own comment. Write a negative fixture. Gate: `pnpm test:harness`
- [ ] T4 — Write the rule (OCP-01, OCP-07): a new inviolable rule 14 in AGENTS.md with the four points, the same rule in
      `feature-worker.md`, and the merge rule in the skill's **pr** step. Write a harness test that AGENTS.md and
      `feature-worker.md` name `scripts/agent/reading-modules.json`. Gate: `pnpm test:harness && pnpm format:check`
- [ ] T5 — Write pinning tests for the survivors in `anchors.rs`, `characters.rs` and `character_screen.rs` (OCP-05).
      Gate: `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib`
- [ ] T6 — Write pinning tests for the survivors in `layout.rs` and `vision.rs` (OCP-05). Gate: as T5
- [ ] T7 — Write pinning tests for the survivors in `name_diff.rs` (including the timeout at line 83) and
      `vocabulary.rs` (OCP-05). Gate: as T5, plus
      `cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`

## Batch 2 (after the orchestrator dispatches the nightly on the branch)

- [ ] T8 — From the branch's nightly, kill or exclude with evidence (OCP-05, OCP-06) every survivor in `core/src/party.rs`
      and `core/src/screen_reader.rs`, and any domain survivor still left. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p d2rmm-agent-domain --lib && pnpm test:harness`

## Orchestrator (local, the maintainer answers the gate)

- [ ] T9 — Add `apps/agent/src-tauri/.cargo/mutants.toml` and `scripts/agent/reading-modules.json` to the gate's
      sensors (OCP-08), with a test in `.claude/hooks/test/gate-rules.test.mjs`. Gate:
      `node --test .claude/hooks/test/gate-rules.test.mjs`
