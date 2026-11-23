# ADR 038 — API mutation scope and equivalent mutants

**Status**: Accepted
**Date**: 2026-11-22 (accepted 2026-11-23 by the maintainer: "aceito")
**Deciders**: maintainer
**Supersedes**: none

## Context

The agent has a documented way to retire an equivalent mutant: an `.cargo/mutants.toml` entry with `file:line`, a reason
and an `Evidence:` line, checked by `scripts/agent/mutation-config.mjs` (AGENTS.md rule 14 (3)). The API (StrykerJS) has
none, so an equivalent mutant stays a survivor forever. Nightly run 45037822441 and PRs #168, #170 and #171
show it: api-domain keeps `lobby-room.ts:118,189,449` (defensive invariant guards) and `matcher.ts:230` (the message of
an unreachable `throw`); api-application keeps about 14 more (lock-map cleanup lines and similar). The
counts here ("61 of 190" below, "about 14") come from that run's Stryker mutation report, a CI artifact of the nightly
workflow and not a file in the repository; a reader without Actions access cannot re-check them from the repo alone.

The API's Stryker `mutate` globs (`apps/api/scripts/mutation-plan.ts`, ADR 014) are:

- domain: `src/modules/*/domain/**/*.ts`, `src/shared-kernel/**/*.ts`, `!src/**/*.test.ts`
- application: `src/modules/*/application/**/*.ts`, `!src/**/*.test.ts`

The application glob also takes the in-memory fakes in `src/modules/*/application/testing/**`. Of 190 api-application
survivors, 61 are in those fakes. A surviving mutant in a fake says nothing about the product: the fakes are test
support, and the unit tests are their only proof (ADR 026). The survivors lower the score and hide the real ones.

Related: ADR 014 (testing and mutation), ADR 026 (mutation against unit tests only), ADR 029 (the ratchet and the nightly
mutation run; it replaces ADR 021's ratchet text), and AGENTS.md rules 3, 4 and 14. No ocr-protection ADR exists; rule 14
in AGENTS.md is the precedent.

## Decision

The three items below are accepted; they are applied by a follow-up feature PR.

1. **Equivalent mutants.** The preferred path stays refactoring the redundancy away (done in #168 where possible). Where
   a mutant is truly equivalent and cannot be removed, the source may carry
   `// Stryker disable next-line <Mutator>: equivalent — <reason>`. A harness check (`scripts/api/mutation-disables.mjs`,
   modelled on `mutation-config.mjs`, with a harness test and wired into `pnpm check`) fails on a `Stryker disable`
   comment with no reason, with no mutator name, or with the blanket `Stryker disable all` / `Stryker disable-line`
   without a mutator. Stryker supports the `// Stryker disable next-line <Mutator>: <reason>` form natively. The check also
   flags a **stale** disable, since a disable survives line moves silently. What it can verify without running Stryker:
   the line after the comment must still contain a construct the named mutator produces (e.g. `StringLiteral` needs a
   string or template literal, `ConditionalExpression` an `if`/ternary/logical operand, `BlockStatement` a block), and
   no comment may be followed by a blank line, another comment or end of file. Whether the mutant was actually generated
   and survived in the last nightly report is not checkable without that report, so the nightly summary lists disables
   that matched no mutant (Stryker reports them as ignored with no match) and the phase review carries that count.
   Each disable names one line and one mutator, so it is visible in review and counted by the check.
2. **Scope.** Take test-support code out of `mutate`: exclude `src/modules/*/application/testing/**` (and
   `src/**/testing/**` for any future support folder). A test-support folder is any `testing/` directory under `src`; the
   harness check also confirms no product file lives in one. Where it lives matters: `SOURCE_GLOBS` in
   `mutation-plan.ts` has no negations and its patterns go to `fs.glob` literally, so a `!` pattern added to that list
   would be taken as a literal path. The exclusion is therefore added in two places that read from one shared list of
   excluded patterns: (a) in `layerConfig`, next to the existing `!src/**/*.test.ts` entry of `mutate` (the nightly's
   Stryker config), and (b) as the same filter in `planLayer`, next to its `.endsWith('.test.ts')` filter (the
   `--changed` runs). A unit test of `mutation-plan.ts` asserts both agree: for a fixture tree with a fake under
   `application/testing/`, `layerConfig(...).mutate` negates it and `planLayer` omits it.
3. **Baseline.** Removing the fakes changes the score denominator. The floors `mutation.api.application` (and the
   `break` value in `mutation-plan.ts`) are re-measured on one nightly after the change. The `break` value in `mutation-plan.ts` and the floor in
   `.quality-baseline.json` change in the same commit (the file's own comment says they mirror each other), and the
   first nightly after the change is the re-measurement: `quality:ratchet` must not read a score against the stale
   baseline of that night as a regression, so the baseline commit and the nightly are reviewed together. Because the removed mutants were
   mostly survivors the score is expected to rise, so the floors can only stay or rise; any lowering is the maintainer's
   decision (rule 4), not the runner's.

## Alternatives considered

- **Leave survivors (status quo).** Simple, but the score never reaches the real ceiling and a real survivor hides among
  the equivalent ones.
- **Raise the tolerance / lower the floors.** Rejected: rule 4 forbids it and it weakens the sensor for every file.
- **Refactor only.** Kept as the preferred path, but some guards are defensive by design (an invariant that no input
  can reach) and removing them weakens the code.
- **A central exclusion file like `.cargo/mutants.toml`.** Stryker has no equivalent, and a line-keyed file drifts when
  lines move; an inline comment moves with the code.
- **Keep the fakes mutated.** Would need tests of the fakes themselves, which prove nothing about the product.

## Consequences

- The API score measures the product; equivalent mutants leave with a written reason that a reviewer can challenge.
- Disable comments are a new place to hide a weak test. The check, the reason requirement and review of each one are the
  guard; the count of disables is reported in the phase review.
- The ratchet baseline and `break` thresholds must be re-measured once; this needs the maintainer's confirmation.
- Revisit after the first two nightlies: if disables pile up in one file, treat that as a design smell.
