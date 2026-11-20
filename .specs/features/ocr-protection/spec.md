# OCR protection — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: no (tests, mutation
config and rules only; no product code changes)

## Problem

The OCR reading logic is the project's highest risk. It was tuned on the maintainer's real prints during the F1
incidents. The nightly now reports survivors in it:

- The domain has 51 missed mutants. 23 are in `anchors.rs`, `character_screen.rs`, `characters.rs` and `layout.rs`, and
  28 more are in `name_diff.rs`, `vocabulary.rs` and `vision.rs`, which feed the reading.
- `core/src/party.rs` and `core/src/screen_reader.rs` are not mutated at all: they are missing from `examine_globs`.
- The core baseline fails because one test is order-dependent:
  `party::look_tests::the_span_of_a_closed_panel_says_neither` expects a span field and gets `[]` under `cargo test`,
  in one process, but passes under nextest.

The maintainer's concern (2026-11-20): an agent asked to kill a mutant could rewrite the reading logic and lose what
the real prints taught. The brief's approval adopted the four-point rule: survivors are killed only by pinning tests;
logic changes need the real-print proof; equivalent mutants are excluded with evidence; the rule goes into AGENTS.md
and the worker instructions.

## Requirements

- **OCP-01** — AGENTS.md SHALL carry the rule as an inviolable rule with the four points, naming the list of reading
  modules (OCP-02). `.claude/agents/feature-worker.md` SHALL repeat it in its rules.
- **OCP-02** — The reading modules SHALL be listed once, in `scripts/agent/reading-modules.json`:
  - in `domain/src/`: `anchors.rs`, `character_screen.rs`, `characters.rs`, `layout.rs`, `game_name_match.rs`,
    `language.rs`, `vocabulary.rs`, `vision.rs` and `name_diff.rs`;
  - in `core/src/`: `party.rs` and `screen_reader.rs`.

  A harness test SHALL fail when a listed file does not exist, or when a listed file is outside cargo-mutants'
  `examine_globs`.

- **OCP-03** — `examine_globs` SHALL include `core/src/party.rs` and `core/src/screen_reader.rs`, and the scope's harness
  tests (`agent-mutation-scope`, `agent-source-rules`) SHALL list them.
- **OCP-04** — The agent core's unit tests SHALL pass both under `cargo test -p d2rmm-agent-core --lib` in one process and
  under nextest. The order-dependent span test SHALL be fixed in the test's setup (its telemetry capture), never by
  changing the reading code or loosening its assertion.
- **OCP-05** — Every survivor in a reading module SHALL either be killed by a new unit test or be excluded as in OCP-06.
  The test pins the current behaviour at the mutated point, with values measured on the real prints (the constants
  documented as measured) or with drawn fixtures. This feature SHALL change no non-test line of a reading module, and
  the `ocr-variations` counts on the feature's PR SHALL equal those of `phase/F2`.
- **OCP-06** — A mutant that no unit test can tell apart, because nearby values read the same on every print, SHALL be
  excluded in `.cargo/mutants.toml` `exclude_re`. Each entry SHALL be preceded by a comment with:
  - the `file:line` and the mutation;
  - why it is equivalent;
  - an `Evidence:` line naming the real-print measurement or the `ocr-variations` run that shows the same counts.

  A harness test SHALL fail on an entry without that comment.

- **OCP-07** — The phase runner's skill SHALL state that a PR changing a non-test line of a reading module merges only
  with `ocr-real` and `ocr-variations` green, and only with the ratchet not regressing (correct floor, wrong ceiling).
  The PR description SHALL show the before and after counts.
- **OCP-08** — The gate hook SHALL ask the maintainer before an edit to `.cargo/mutants.toml` or
  `scripts/agent/reading-modules.json`, like the other sensors.

## Sources

| ID     | Source                                                                                 |
| ------ | -------------------------------------------------------------------------------------- |
| OCP-01 | F2 brief, input 1 (approved 2026-11-20); F1 `post-close.md` § Protecting the OCR logic |
| OCP-02 | same; ocr-protection facts (vocabulary, vision, name_diff feed the reading)            |
| OCP-03 | ADR 026; the nightly of 2026-11-19 (party and screen_reader never mutated)             |
| OCP-04 | ADR 026; AGENTS.md rule 3; the nightly baseline failure of 2026-11-19                  |
| OCP-05 | brief input 1, point 1; AGENTS.md rule 3                                               |
| OCP-06 | brief input 1, point 3; the `pair_once` precedent in `.cargo/mutants.toml`             |
| OCP-07 | brief input 1, point 2; `.quality-baseline.json` `ocr.variations.*`                    |
| OCP-08 | AGENTS.md rule 4 (sensors); brief input 1, point 4                                     |

## Requirement Traceability

| Requirement ID | Story      | Proof                                                                                  |
| -------------- | ---------- | -------------------------------------------------------------------------------------- |
| OCP-01         | Rule       | harness test reads AGENTS.md and feature-worker.md + acceptance `@OCP-01`              |
| OCP-02         | List       | harness test with a negative fixture                                                   |
| OCP-03         | Scope      | `agent-mutation-scope` and `agent-source-rules` harness tests                          |
| OCP-04         | Baseline   | `cargo test -p d2rmm-agent-core --lib` in the task gate                                |
| OCP-05         | Survivors  | the nightly dispatched on the branch: 0 unexplained survivors; `ocr-variations` counts |
| OCP-06         | Exclusions | harness test with a negative fixture + acceptance `@OCP-06`                            |
| OCP-07         | Merge rule | review of the skill text                                                               |
| OCP-08         | Sensor     | `.claude/hooks/test/gate-rules.test.mjs`                                               |

## Decisions (conservative defaults)

- `vocabulary.rs`, `vision.rs` and `name_diff.rs` join the protected list, because the reading depends on them.
  Protecting more costs only tests.
- The survivor list comes from the nightly dispatched on the feature branch with `gh workflow run`, never from a task
  gate: ADR 029 keeps mutation out of the gates.
- OCP-08 edits a hook, so the orchestrator applies it on the Mac and the maintainer answers the gate's prompt. Cloud
  workers do not touch `.claude/hooks/`.
