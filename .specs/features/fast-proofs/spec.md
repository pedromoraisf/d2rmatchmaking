# Fast Proofs Specification

**Approved**: 2026-11-09 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

**Amended by the runner** (assumed, AD-174; to confirm at the phase review): 2026-11-09. Execute found that the wrapper accepts only `spec`, `design`, `tasks`, `proofs`, `verification`, `integration` and task IDs as steps. `fix` is a commit-trailer step only. FPR-09 is appended so the step FPR-07 names exists. No other criterion is edited.

## Problem Statement

In F0, `check_proofs` ran 65 times for 8.9 hours. Each run re-proves every check of a feature, and with `--mutations`
it also re-applies every mutation, even when a fix touched one file. A run takes 18 to 40 minutes on the phase machine,
and a fix loop needs several. This row adds a preflight that runs a feature's proofs, caches each green one, and on
later runs reruns only the proofs whose inputs changed. The official `check_proofs.py` then runs once, when the
preflight is green. Source: `.specs/phases/F0/brief-revision-6.md` § 3 (fast-proofs), approved by the maintainer on
2026-11-07. The maintainer chose the fast mode for the remaining harness rows on 2026-11-09 ("B. Modo rápido no
harness").

## Goals

- [ ] A fix loop reruns no proof while its command and the feature's changed files are unchanged since its last green run.
- [ ] `check_proofs.py` runs at most twice per feature (brief § 1: two official runs at most): once when the preflight is green, and once more only if that run fails (FPR-07).

## Out of Scope

| Feature                                               | Reason                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Changing `check_proofs.py` or any vendored TLC script | Vendored (AGENTS.md "Never do")                                                     |
| Caching mutation runs                                 | A mutation's verdict depends on the whole source; the official run keeps it         |
| Running proofs in parallel                            | The phase machine is the bottleneck (brief § 1); measured by `parallel-cloud-spike` |
| Changing the retry budget or the gate                 | `budget-v2` and `gate-precision`                                                    |

---

## Assumptions & Open Questions

| Assumption / decision     | Chosen default                                                                                                              | Rationale                                                                                                            | Confirmed?          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| What a proof's inputs are | Its command plus the content of every file the branch changes against `phase/<F>`, committed, staged, unstaged or untracked | The brief's key; a proof can only change result when the feature's own files change                                  | n - AD-174, assumed |
| Where the cache lives     | `reports/proofs-cache/<feature>.json`, which `.gitignore` already ignores                                                   | Local only, never committed, like `reports/attempts/`                                                                | n - AD-174, assumed |
| How the preflight runs    | Through the wrapper as step `fix`. The official `check_proofs.py` stays step `proofs` (brief § 3)                           | `fix` is the closed-list step of the fix loop, so the preflight and the official run keep separate budgets (ADR 022) | n - AD-174, assumed |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The preflight reruns only what changed ⭐ MVP

**User Story**: As the runner, I want a feature's proofs cached while their inputs stay the same, so that a fix loop reruns only the proofs it can have changed.

**Why P1**: proof reruns cost 8.9 hours in F0.

**Acceptance Criteria** (each line is one EARS pattern and one requirement ID):

1. FPR-01: WHEN `node scripts/proofs-preflight.mjs <feature>` runs THEN it SHALL run, from the repository root, each `Proof:` command of `.specs/features/<feature>/tasks.md` `## Checks`, in file order, and print per proof its check ID, `ran` or `cached`, its exit code and its seconds
2. FPR-02: WHEN a proof exits 0 THEN the preflight SHALL record it as green in `reports/proofs-cache/<feature>.json` under a key that is the SHA-256 of the command and of the path and content of every file the branch changes against `phase/<F>`, committed, staged, unstaged or untracked
3. FPR-03: WHEN a proof's key equals a key recorded green THEN the preflight SHALL NOT run it and SHALL print it as `cached`
4. FPR-04: WHEN a proof's key differs from every green key, or its last run failed, THEN the preflight SHALL run it
5. FPR-05: The preflight SHALL exit 0 only when every proof is green, ran or cached, and otherwise exit 1 after printing the check IDs that failed
6. FPR-06: IF the cache file is missing or unreadable, or git cannot list the changed files, THEN the preflight SHALL run every proof and SHALL NOT fail for that reason

**Independent Test**: run the preflight twice on a fixture feature in a temporary git repository and read what ran.

---

### P1: The fix loop uses the preflight

**User Story**: As the maintainer, I want the runner's guide to say how the preflight and the official proofs are used, so that the official run happens once per feature.

**Why P1**: without the guide the runner keeps calling `check_proofs.py` in its fix loop.

**Acceptance Criteria**:

1. FPR-07: The Verify step of `.claude/skills/d2rmm-phase-runner/SKILL.md` SHALL say that the fix loop runs `proofs-preflight.mjs` through the wrapper as step `fix`, that `check_proofs.py` runs as step `proofs` once, when the preflight is green, and that it runs a second time only if that run fails
2. FPR-08: WHEN `pnpm test:harness` runs on the feature's head THEN it SHALL pass with no test removed or skipped, and `check_proofs.py` SHALL be unchanged
3. FPR-09: `node scripts/attempt.mjs run --feature <f> --step fix -- "<cmd>"` SHALL be accepted, and SHALL run and count under its own unit `gate:<f>/fix`

**Independent Test**: read the skill's Verify step; run the harness suite.

---

## Edge Cases

- FPR-04 covers a proof whose last run failed with the same key: it runs again.
- FPR-06 covers a first run, a corrupt cache and a git error: everything runs.
- FPR-02 covers a deleted file: its path is part of the key, with empty content.

---

## Requirement Traceability

| Requirement ID | Story                                      | Phase | Status  |
| -------------- | ------------------------------------------ | ----- | ------- |
| FPR-01         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-02         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-03         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-04         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-05         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-06         | P1: The preflight reruns only what changed | Tasks | Pending |
| FPR-07         | P1: The fix loop uses the preflight        | Tasks | Pending |
| FPR-08         | P1: The fix loop uses the preflight        | Tasks | Pending |
| FPR-09         | P1: The fix loop uses the preflight        | Tasks | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 9 total, 9 mapped to tasks, 0 unmapped

---

## Sources

- `.specs/phases/F0/brief-revision-6.md` § 1 (proof reruns: 65 runs, 8.9 h) and § 3 (fast-proofs) (FPR-01 to FPR-07, FPR-09)
- ADR 022 - the retry budget the preflight runs under (FPR-05, FPR-07)
- ADR 023 - acceptance scenarios (FPR-07)
- `docs/product/prd.md#NFR-11` - harness verified in CI (FPR-08)

---

## Success Criteria

- [ ] A second preflight run with no change runs no proof.
