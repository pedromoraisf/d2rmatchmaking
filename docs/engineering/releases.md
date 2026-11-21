# Releases

The desktop agent (`apps/agent`) is the only released package in F0. Releases follow ADR 015: release-please keeps the
release PR, a merge creates the tag and the GitHub Release, and `release-agent.yml` builds the Windows installer and
publishes it. Installed agents read `latest.json` from the latest release (AGS-24).

## How a release happens

1. Commits reach `main`. `release-please.yml` opens or updates one release PR for `apps/agent`, and runs `ci.yml` on the
   PR branch so the required `verify` check appears (`workflow_dispatch`, because a `GITHUB_TOKEN` PR gets no
   `pull_request` run).
2. The maintainer merges the release PR. release-please creates the GitHub Release as a **draft** (`draft: true` in
   `release-please-config.json`), with no assets and not Latest, and creates the tag `agent-v<version>` itself
   (`force-tag-creation: true`; GitHub makes no tag for a draft). The site's download link and installed agents'
   `latest.json` still point at the previous release.
3. The same workflow calls `release-agent.yml` with that tag (a tag made with `GITHUB_TOKEN` starts no `push: tags`
   run, so the call is the path). Four jobs run in order (`smoke → build → sign → publish`), and **nothing is public until the last one**
   (agent-release, AGR-01, AGR-02):
   - `smoke` (the stage workflow `stage-smoke`, `app: agent`): wakes the API (`/healthz`, retried for up to 90 s, Render's free
     tier sleeps) and checks that it answers ok. Any build answers, so no SHA is compared. It needs no secret; `build` waits for it.
   - `build` (`windows-latest`, `release` environment): reads `SIGNPATH_ENABLED` once (the output `signing`, which `sign`
     and `publish` use), refuses a release that is already public, then `tauri-action` attaches the installer, its updater signature and
     `latest.json` to the draft. With the API awake (`smoke`), `--self-check --online` and
     the `--read-fixture` refusal run. Only after they pass does it attach `D2RMatchMaking-setup.exe` (a fixed name, so
     the site's download link never changes) and `SHA256SUMS`.
   - `sign` (only when `SIGNPATH_ENABLED` is `true`): SignPath signs the installer, the updater signature is redone, and
     the draft's installer, `latest.json` and `SHA256SUMS` are replaced (`--clobber`, on a draft only).
   - `publish` (`windows-latest`, no secret): downloads the draft's assets, verifies the Authenticode signature of both
     installers (signed flow only: valid, and by `SIGNPATH_PUBLISHER`), checks the assets as a set
     (`scripts/agent/release-assets.mjs`: only the expected asset names, `latest.json` with this repository's exact download
     URL and no platform but `windows-x86_64`, and every `.sig` verified against its file with the updater key of
     `tauri.conf.json`), and runs `gh release edit --draft=false`, once. It is marked Latest only when its
     tag is the newest `agent-v*` (`scripts/agent/publish-release.mjs`); a release that is already public is left alone.
4. The first release after the merge is the phase review's proof (C43).

### Maintainer steps, in order

1. Open the release PR. Its bot-authored `pull_request` runs wait as `action_required`: click **Approve and run**. The
   dispatched `ci` run alone does not unblock the PR.
2. When `verify` is green, approve the PR and merge it.
3. Open the `release-agent` run (Actions) and approve the `release` environment deployment of `build`.
4. With signing on: approve the SignPath signing request (ADR 016: a manual approval per release) and the `release`
   deployment of `sign`.
5. Wait for `publish` to finish. Until then the release is a draft and nothing public changes.

### What a failure leaves behind

| Where it fails                               | What is left                                                   | What to do                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `build` (compile, self-check, upload)        | the draft (maybe with some assets) and the tag                 | fix the cause, re-run the tag (`workflow_dispatch` of `release-agent.yml`); `build` replaces the draft's assets (`--clobber`) |
| `sign` (rejected, timed out, never approved) | the draft with the **unsigned** assets; `publish` does not run | approve or re-submit and re-run; or take the fallback below                                                                   |
| `publish` (asset check, signature check)     | the draft with the signed or unsigned assets                   | read the `::error::` line, fix the assets, re-run                                                                             |

A re-run is safe because every job that replaces assets first refuses a public release (`gh release view … isDraft`): a
release that already went public is never edited, and re-running its tag fails at that guard with a clear message.

A release is never public with an unsigned installer while signing is on, and `releases/latest` (the site's link, installed
agents' `latest.json`) keeps the previous release until `publish` succeeds.

### Fallback when SignPath is slow or down

Set the repository variable `SIGNPATH_ENABLED` to `false` and re-run the tag: the release is built, checked and published
unsigned, and the site keeps its SmartScreen note (`VITE_INSTALLER_SIGNED` stays `false`). Turn signing on again for the next
release. A rerun with signing on after an unsigned publication is a new, higher version.

`agent-v0.0.1` has no assets: its build failed and the tag cannot move, so `agent-v0.0.2` is the first installable
release and the oldest version that can self-update.

release-please only counts commits that touch `apps/agent`. To release with no behavior change, as the self-update proof
does, use a `chore(agent)` commit with the footer `Release-As: <version>`.

A tag pushed by hand (`agent-v*`) starts `release-agent.yml` through its `push: tags` trigger. A failed release (the draft and its
tag remain) re-runs through `workflow_dispatch` of `release-agent.yml` with the tag as input.

## Maintainer setup (once)

- Environment `release`: required reviewers on; secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; secret `SIGNPATH_API_TOKEN` only when signing is enabled.
- Repository variables: `API_BASE_URL` (the Render API URL, built into the agent) and `SIGNPATH_ENABLED` (`true` turns
  on the signing job; unsigned otherwise, AD-053). When signing is on, also `SIGNPATH_ORGANIZATION_ID`,
  `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` and `SIGNPATH_PUBLISHER` (the signer's CN or O as it appears on
  the certificate, e.g. `SignPath Foundation`; unset reads "not configured" and `publish` refuses). The maintainer creates
  all of them (AGENTS.md rule 7); the workflow only reads them.
- Import `.github/rulesets/agent-release-tags.json` (tags `agent-v*` cannot be moved or deleted once created).

## Rules

- `releases/latest` is repository-wide. Any future released package sets `make_latest: false` on its release, or the
  agent's `latest.json` stops being the latest (ADR 015).
- Signing secrets exist only in the `release` environment, and only `build` and `sign` read them; `publish` reads none.
  Nothing installs scripts while the signing key is in scope.
- Only `release-agent.yml` and `release-please.yml` create, edit or upload to a release. Preview and staging installers are
  workflow artifacts (ADR 033 §8).
- The `fixture-read` feature never reaches a release build (AGS-33); the build checks it before packaging.

## Fallback

- The release PR shows no `verify` check: close and reopen the release PR. The reopen runs `pull_request` CI.
- Rolling back an agent release: publish a higher version. Installed agents update only to a higher version, and a
  tag is never moved (the ruleset).
- The updater key is embedded in every installed agent. Rotation is a maintainer decision (queued in
  `.specs/phases/F0/decisions.md`).
