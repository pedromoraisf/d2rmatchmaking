# Releases

The desktop agent (`apps/agent`) is the only released package in F0. Releases follow ADR 015: release-please keeps the
release PR, a merge creates the tag and the GitHub Release, and `release-agent.yml` builds the Windows installer and
publishes it. Installed agents read `latest.json` from the latest release (AGS-24).

## How a release happens

1. Commits reach `main`. `release-please.yml` opens or updates one release PR for `apps/agent`, and runs `ci.yml` on the
   PR branch so the required `verify` check appears (`workflow_dispatch`, because a `GITHUB_TOKEN` PR gets no
   `pull_request` run).
2. The maintainer merges the release PR. release-please creates the tag `agent-v<version>` and the GitHub Release.
3. The same workflow calls `release-agent.yml` with that tag. The build runs on `windows-latest` in the `release`
   environment and publishes `latest.json`, `D2RMatchMaking-setup.exe` (a fixed name, so the site's download link never
   changes) and `SHA256SUMS`.
4. The first release after the merge is the phase review's proof (C43).

`release-please-config.json` holds `"release-as": "0.0.1"` for that first release, because release-please would propose
`1.0.0` otherwise. Remove the line right after `agent-v0.0.1` exists: while it stays, release-please keeps proposing
0.0.1 and `agent-v0.0.2` cannot happen.

A tag pushed by hand (`agent-v*`) starts `release-agent.yml` through its `push: tags` trigger. A failed release re-runs
through `workflow_dispatch` of `release-agent.yml` with the tag as input.

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
