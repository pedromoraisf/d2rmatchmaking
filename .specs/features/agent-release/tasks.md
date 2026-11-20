# Agent release — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-agent-release` → `phase/F2`

Rules:

- One PR for the feature, into `phase/F2`, after Batch 1. The feature file reaches the phase branch **only inside that
  PR**, with its steps: `playwright-bdd` runs with `missingSteps: 'fail-on-gen'`, so `acceptance.feature` without steps
  fails every other PR's acceptance run (lessons). The steps for `@AGR-08` and `@AGR-09` are written by T6 and T7
  (`tests/acceptance/steps/agent-release.steps.ts`). Until then `--grep @AGR-` reports 16 missing steps: that is the
  draft, not a failure of a task.
- Release code is written test first: the harness test or the unit test goes in the commit before the change it pins, or in
  the first step of the same task, and it fails on the unchanged code.
- A task that changes `release-agent.yml` keeps every existing test of `scripts/test/release-workflows.test.mjs` green
  and edits one only where the spec changes the order (T3 says which). Never loosen a test to pass (rule 3).
- The release workflows cannot run in a cloud session (`windows-latest`, the `release` environment, the maintainer's
  approval). Their proof is the harness tests here and the first real run after the phase merges; each task that needs a
  real run says "run: waiting".
- Nothing here touches `.quality-baseline.json`, a ruleset, a secret or a repository variable: the maintainer creates
  those (rule 7). The workflow only reads them.
- Before pushing in a fresh worktree, build the agent window once (`pnpm --filter @d2rmm/agent build`).

## Batch 1 — publish after sign, the asset checker, the page

- [ ] T1 — Pin the new order with harness tests that fail on today's workflow (AGR-01, AGR-02, AGR-05, AGR-10): `publish`
      is a job of its own with `needs: [build, sign]` and the `always()` condition of the spec; exactly one `--draft=false`
      in the file and it is in `publish`; `build` no longer runs `gh release edit`; `--clobber` appears only in `sign`; no
      workflow but `release-agent.yml` and `release-please.yml` calls `gh release` or `softprops`/`tauri-action` with a tag;
      the secrets `TAURI_SIGNING_PRIVATE_KEY` and `SIGNPATH_API_TOKEN` appear only in `build` and `sign`. Gate (red on
      purpose until T3, so run it in the same commit as T3's change if the hook requires a green tree):
      `node --test scripts/test/release-workflows.test.mjs`
- [x] T2 — `scripts/agent/release-assets.mjs` and its test (AGR-03): `checkRelease({ tag, files })` returns the list of
      problems for the six checks of the spec, over drawn asset sets (complete; missing `SHA256SUMS`; fixed-name file
      differs; a hash that does not match; `latest.json` version of another tag; URL of another asset; stale signature).
      Pure functions over file contents, plus a thin CLI (`--dir <downloaded assets> --tag <tag>`), exit 1 with one line per
      problem. Gate: `node --test scripts/test/release-assets.test.mjs`
- [ ] T3 — Reorder `release-agent.yml` (AGR-01, AGR-02, AGR-06): `build` keeps tauri-action into the draft, the wake and the
      two smoke checks, uploads the fixed-name installer and `SHA256SUMS` **to the draft**, and no longer publishes; `sign`
      stays as it is (replaces the draft's assets, `--clobber`); the new `publish` job downloads the draft's assets, runs
      `release-assets.mjs`, and publishes once, `--latest` only for the newest tag, doing nothing when the release is already
      public. The one existing test that says "the release is published and marked latest only after the self-check" is
      updated to name the `publish` job: the self-check still comes first. Gate:
      `node --test scripts/test/release-workflows.test.mjs scripts/test/latest-json.test.mjs scripts/test/release-assets.test.mjs`
- [ ] T4 — The publish helper and the Authenticode verdict (AGR-04, AGR-06): `scripts/agent/publish-release.mjs` decides, from
      the release's state (`draft`, tag, newest agent tag), whether to publish, to publish without Latest, or to do nothing;
      `scripts/agent/signature-verdict.mjs` turns the `Status` and the signer's subject that PowerShell's
      `Get-AuthenticodeSignature` returned into pass or a reason, against the expected subject. Both are pure, tested on
      drawn inputs, and called from `publish` (the PowerShell step prints the two values as JSON). Gate:
      `node --test scripts/test/publish-release.test.mjs scripts/test/signature-verdict.test.mjs scripts/test/release-workflows.test.mjs`
- [ ] T5 — The runbook (AGR-11): `docs/engineering/releases.md` and the agent row of `docs/engineering/delivery.md` state the
      new order, the maintainer's steps (approve and run, merge, approve the `release` environment, approve the SignPath
      request), what each failure leaves (a draft) and the fallback (`SIGNPATH_ENABLED` to `false`, re-run the tag). A
      harness test checks that every `vars.*` and `secrets.*` that `release-agent.yml` reads is named in the runbook.
      Gate: `pnpm format:check && pnpm specs:check && node --test scripts/test/release-workflows.test.mjs`
- [ ] T6 — The code signing policy page (AGR-08): the `/code-signing` view of the site, English and pt-BR strings, the typed
      list of roles (the maintainer's public GitHub handle for committer, reviewer and approver until the maintainer says
      otherwise: **the contact email is not written here, T9 adds it**), the footer link, the README link, and the steps
      for `@AGR-08`. Component tests in both languages with fake locale. Gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint && pnpm exec turbo run test:acceptance -- --grep @AGR-08`
- [ ] T7 — The SmartScreen note follows one setting (AGR-09): `VITE_INSTALLER_SIGNED` (default `false`) decides whether
      `Layout` shows `app.smartScreenNote`; the existing `Layout.test.tsx` cases stay for the default, new cases cover
      `true`; the steps for `@AGR-09`. Gate:
      `pnpm --filter @d2rmm/web exec vitest run src/app && pnpm --filter @d2rmm/web lint && pnpm exec turbo run test:acceptance -- --grep @AGR-09`

## Batch 2 — written after Batch 1 merges; the SignPath steps wait for the maintainer

- [ ] T8 — Release the agent 0.4.0 through the draft flow (AGR-07). **Runs after the phase PR merges into `main`**
      (release-please only reads `main`): the maintainer approves and runs the bot PR's workflows, merges it and approves the
      `release` environment; the worker reads the run, checks the draft's assets with `release-assets.mjs` and
      `--self-check --online`, and writes the links into the phase review. Gate: the release links. (run: waiting on the
      phase merge)
- [ ] T9 — The policy page's roles and contact email (AGR-08). **Waiting**: brief input 9 (SignPath roles and the contact
      email). Then the typed list and both locales get them. Gate: as T6.
- [ ] T10 — Apply to SignPath Foundation (ADR 016). **Waiting**: the maintainer applies, with the page's URL, and creates
      the organisation, the project, the signing policy and the `SIGNPATH_API_TOKEN` secret and the four `SIGNPATH_*`
      variables in the `release` environment (rule 7). No task of this feature creates them.
- [ ] T11 — The first signed release (AGR-01, AGR-04, AGR-10). **Waiting**: T10 and SignPath's acceptance. The maintainer sets
      `SIGNPATH_ENABLED` and `SIGNPATH_PUBLISHER` and approves the request; the worker reads the run (draft until signed,
      Authenticode verdict, `latest.json` signature, an installed agent updating) and writes the links into the review.
- [ ] T12 — Turn the SmartScreen note off (AGR-09). **Waiting**: T11. One change sets `VITE_INSTALLER_SIGNED=true` for the site
      in the same pull request that the maintainer approves for `SIGNPATH_ENABLED`. Gate: as T7.
