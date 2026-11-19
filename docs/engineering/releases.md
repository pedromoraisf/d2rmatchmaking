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
   run, so the call is the path). The build runs on `windows-latest` in the `release` environment and `tauri-action`
   attaches the installer and `latest.json` to the draft. The API is woken (`/healthz`, retried for up to 90 s), then
   `--self-check --online` runs. Only after it passes does the last step upload `D2RMatchMaking-setup.exe` (a fixed
   name, so the site's download link never changes) and `SHA256SUMS` and publish the release
   (`gh release edit --draft=false`). It is marked Latest only when its tag is the newest `agent-v*`; a rerun of an
   older tag passes `--latest=false`.
4. The first release after the merge is the phase review's proof (C43).

### Maintainer steps, in order

1. Open the release PR. Its bot-authored `pull_request` runs wait as `action_required`: click **Approve and run**. The
   dispatched `ci` run alone does not unblock the PR.
2. When `verify` is green, approve the PR and merge it.
3. Open the `release-agent` run (Actions) and approve the `release` environment deployment.
4. Wait for the run to publish the release. Until then the release is a draft and nothing public changes.

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
  on the signing job; unsigned otherwise, AD-053).
- Import `.github/rulesets/agent-release-tags.json` (tags `agent-v*` cannot be moved or deleted once created).

## Rules

- `releases/latest` is repository-wide. Any future released package sets `make_latest: false` on its release, or the
  agent's `latest.json` stops being the latest (ADR 015).
- Signing secrets exist only in the `release` environment. Nothing installs scripts while the signing key is in scope.
- The `fixture-read` feature never reaches a release build (AGS-33); the build checks it before packaging.

## Fallback

- The release PR shows no `verify` check: close and reopen the release PR. The reopen runs `pull_request` CI.
- Rolling back an agent release: publish a higher version. Installed agents update only to a higher version, and a
  tag is never moved (the ruleset).
- The updater key is embedded in every installed agent. Rotation is a maintainer decision (queued in
  `.specs/phases/F0/decisions.md`).
