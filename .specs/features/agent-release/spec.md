# Agent release — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium (no `design.md`: one workflow reorder, one
checker script, one static page) · **Security review**: yes (signing key and token scope, the order of publication)

## Problem

The agent is released by ADR 015: release-please keeps a release PR, a merge creates a **draft** GitHub Release and the tag
`agent-v*`, `release-agent.yml` builds on `windows-latest`, starts the binary with `--self-check --online`, and publishes.
ADR 016 adds Windows signing through SignPath Foundation. What is there today, read from `release-agent.yml`:

- **Signing runs after publication.** The `build` job uploads the fixed-name installer and `SHA256SUMS` and publishes the
  release (`gh release edit --draft=false`, Latest for the newest tag). Only then does the optional `sign` job run, and it
  replaces the installer, `latest.json` and `SHA256SUMS` with `--clobber`. For the length of the signing job, a public,
  Latest release holds an **unsigned** installer, and installed agents read a `latest.json` that changes under them. A
  failed or never-approved signing request leaves the unsigned release public. The brief calls for **publish after sign**.
- **Nothing checks the assets as a set before they go public.** `latest.json`'s version and installer URL, its updater
  signature, the fixed-name installer and `SHA256SUMS` are each produced by a different step. A stale signature does not
  fail the build; it fails every installed agent's update (AGS-26) after the release is already Latest.
- **No signing policy page exists.** SignPath Foundation requires the project to publish its code signing policy on its
  site, with the roles and a privacy statement. The site has only the SmartScreen note beside the download link.
- **0.4.0 and every later release must go through the draft flow** with assets and `--self-check --online` (brief exit
  criterion "Releases"). The first release after `agent-room-lifecycle` and `screen-recognition` is that proof.

Signing itself waits for SignPath (brief, input 9, "Out of scope": F2 only prepares for it). Everything below that needs the
maintainer's roles, contact email or the SignPath organisation is marked as waiting in `tasks.md`.

## Requirements

- **AGR-01** — WHILE `vars.SIGNPATH_ENABLED` is `true` THEN a release SHALL become public, and Latest, only after the
  signed installer, its updater signature, the rewritten `latest.json`, the fixed-name installer and `SHA256SUMS` are
  attached to it. Until then it SHALL stay a draft, so the download link and `releases/latest/download/latest.json` keep
  pointing at the previous release. WHILE it is not `true` THEN the release SHALL be published after the self-check, as
  today, unsigned.
- **AGR-02** — The release SHALL be published by one step, in its own job that needs the `build` job and, when signing is
  on, the `sign` job. No step before it SHALL make a release public, and `--clobber` SHALL touch only a release that is
  still a draft. A signing request that fails, is rejected or waits for approval SHALL leave the draft and its tag as they
  are and SHALL NOT publish an unsigned installer in its place.
- **AGR-03** — Before publication the workflow SHALL run a tested checker over the draft's assets and refuse to publish
  when any of these fails: the versioned installer, `D2RMatchMaking-setup.exe`, `SHA256SUMS` and `latest.json` are all
  present; `D2RMatchMaking-setup.exe` and the versioned installer are byte-identical; every line of `SHA256SUMS` matches
  the asset it names; `latest.json`'s `version` equals the tag's version; its `windows-x86_64` URL names the versioned
  installer of this release; and its signature equals the `.sig` of that installer.
- **AGR-04** — WHILE signing is on THEN, before publication, the workflow SHALL verify that the installer to be published
  carries a valid Authenticode signature whose publisher is the expected one (a repository variable), and SHALL refuse to
  publish an installer that is unsigned, invalid or signed by another publisher.
- **AGR-05** — The release build SHALL be the production channel (identifier `com.d2rmm.agent`, updater on, the production
  API's address), and a preview or staging installer SHALL never be created, attached or edited as a GitHub Release (ADR
  033 §8). The binary that is published SHALL have started with `--self-check --online` against the production API, woken
  first with a backoff of up to 90 s, and SHALL have refused `--read-fixture` with exit code 2 (AGS-33).
- **AGR-06** — A re-run of a failed release (`workflow_dispatch` with the tag) SHALL resume from the draft that exists and
  SHALL be safe to repeat: re-running a tag that is already public changes nothing and does not fail, and a re-run of an
  older tag SHALL NOT move Latest back.
- **AGR-07** — Agent 0.4.0, and every later release, SHALL be produced by the draft flow (release-please draft, build,
  self-check, publish) with every asset of AGR-03 attached. An agent already installed at 0.3.0 SHALL find the new
  `latest.json`, verify its updater signature and offer the update (AGS-24, AGS-26).
- **AGR-08** — The site SHALL publish a **code signing policy page** at a stable address, in English and in Brazilian
  Portuguese, that states: the project and its licence, that free code signing is provided by SignPath.io with a
  certificate from SignPath Foundation, the roles (who commits, who reviews and who approves a signing request), what the
  signed program does and does not do (it reads the game window's pixels and OS signals only, ADR 010), and a privacy
  statement that matches the agent's own (NFR-04, NFR-05). The page SHALL be linked from the site's footer and from the
  repository README.
- **AGR-09** — WHILE the latest release is unsigned THEN the site SHALL show the SmartScreen note beside the download link,
  as today. WHEN the maintainer turns signing on THEN one setting SHALL remove the note, in the same change that sets
  `SIGNPATH_ENABLED`, so the site never says "signed" about an unsigned installer.
- **AGR-10** — Signing material and the signing request SHALL stay inside the `release` environment's two jobs. The signing
  key and the SignPath token SHALL be read only by `build` and `sign`; both SHALL install with `--ignore-scripts`; `sign`
  SHALL submit the exact artifact id that `build` produced and nothing it downloaded afterwards; every third-party action
  SHALL be pinned by a 40-character SHA; and the unsigned artifact SHALL live one day.
- **AGR-11** — The runbook (`docs/engineering/releases.md`) and the delivery page (`docs/engineering/delivery.md`) SHALL
  state, in order: the maintainer's steps (approve and run the bot PR's workflows, merge, approve the `release`
  environment, approve the SignPath request), what each failure leaves behind (a draft, never a public unsigned
  installer), and the fallback when SignPath is slow or down (set `SIGNPATH_ENABLED` to `false`, re-run the tag, and
  accept an unsigned release with the SmartScreen note).

## Sources

| ID     | Source                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGR-01 | Brief exit criterion "Releases", "SignPath and publish-after-sign → `agent-release`"; ADR 016; the order of jobs in `release-agent.yml` today         |
| AGR-02 | ADR 015; lessons (release-please publishes at once unless a draft; a draft has no assets until the build ends); `release-agent.yml` `--clobber`       |
| AGR-03 | FR-29; AGS-24, AGS-26 (an update fails on a stale signature); `scripts/agent/latest-json.mjs`; ADR 015 (fixed installer name, `latest.json`)          |
| AGR-04 | ADR 016 (Authenticode, SignPath); brief "Releases"; a signed release is the reason for the whole feature                                              |
| AGR-05 | ADR 033 §8 (agent channels, the `releases/latest` rule); lessons ("a binary handed to a human is started by CI first"; Render's sleep); AGS-33        |
| AGR-06 | lessons ("release-please draft"; a failed build leaves the draft and the tag); `docs/engineering/releases.md` ("Fallback"); ADR 015 (`--latest` rule) |
| AGR-07 | Brief exit criterion "Releases" (agent 0.4.0); FR-29; AGS-24, AGS-26; `agent-room-lifecycle` and `screen-recognition` are the first changes released  |
| AGR-08 | Brief exit criterion "the code signing policy page is ready for SignPath"; brief input 9; ADR 016; ADR 010; NFR-04, NFR-05                            |
| AGR-09 | ADR 016 ("until accepted, releases are unsigned and the site explains the warning"); `apps/web` `app.smartScreenNote`                                 |
| AGR-10 | AGENTS.md rules 6 and 7; ADR 016; `release-agent.yml` (`environment: release`, `--ignore-scripts`); lessons (pin by SHA); security review of this PR  |
| AGR-11 | Lessons ("a bot-authored release PR needs Approve and run"); ADR 016 ("manual approval per release"); `docs/engineering/releases.md`                  |

## Threats

| Threat                                                                                    | What stops it                                                                                              | Req            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| Players download an unsigned installer from a release that is "Latest" while signing runs | Publication is the last job; a draft is invisible to `releases/latest`                                     | AGR-01, AGR-02 |
| The signing request fails or waits, and an unsigned release stays public                  | A failed `sign` leaves the draft; publication needs it                                                     | AGR-02         |
| `latest.json` carries the updater signature of the unsigned file, so every update fails   | The checker compares the signature with the `.sig` of the installer that ships                             | AGR-03         |
| The wrong or an old installer is attached under the fixed name                            | The checker compares the fixed-name file with the versioned one and `SHA256SUMS`                           | AGR-03         |
| An installer signed by someone else, or not at all, is published as the signed one        | Authenticode status and publisher are verified before publication                                          | AGR-04         |
| A preview or staging build reaches `releases/latest`, so installed agents update to it    | Only `release-agent.yml` touches releases; a harness test fails any other workflow that calls `gh release` | AGR-05         |
| A release is built for a tag that is not on `main` or is not a version tag                | Kept from AGS-28: the tag is validated once and must be an ancestor of `origin/main`                       | AGR-06 (kept)  |
| A re-run moves Latest back to an older tag or fails on a release that is already public   | `--latest` only for the newest tag; publishing a public release is a no-op                                 | AGR-06         |
| The signing key or the SignPath token is read by a step that runs untrusted code          | Both live only in the `release` environment, `--ignore-scripts`, pinned actions, no `pull_request_target`  | AGR-10         |
| The unsigned artifact is swapped between `build` and `sign`                               | `sign` submits the artifact id `build` outputs; the artifact lives one day                                 | AGR-10         |
| The site says "signed" before the first signed release, or keeps warning after it         | One setting drives the note, changed in the same change as `SIGNPATH_ENABLED`                              | AGR-09         |
| The policy page promises something the agent does not do (captures, sends, keeps)         | The page repeats ADR 010 and NFR-04/05 and is reviewed with the privacy statement of the agent             | AGR-08         |

## Requirement Traceability

| Requirement ID | Story                          | Proof                                                                                                             |
| -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| AGR-01         | Nothing unsigned goes public   | Harness test on the job graph of `release-agent.yml`; the first real signed run (waiting)                         |
| AGR-02         | One publication, last          | Harness test (one `--draft=false`, in the `publish` job; `--clobber` only before it); a failed-sign run (waiting) |
| AGR-03         | The assets agree               | Unit tests of `scripts/agent/release-assets.mjs` on drawn asset sets; the `publish` job runs it                   |
| AGR-04         | The signature is the right one | Unit tests on the parsed verdict; the first real signed run (waiting)                                             |
| AGR-05         | One channel releases           | Harness tests on `release-agent.yml` and `agent.yml`; the existing self-check and fixture-read tests stay         |
| AGR-06         | Re-runs are safe               | Unit tests of the publish helper (public, draft, older tag); a re-run in the nightly-free rehearsal on a test tag |
| AGR-07         | 0.4.0 through the draft flow   | Release links in the phase review; an installed 0.3.0 offered the update (maintainer's field check)               |
| AGR-08         | The policy page                | Web component tests (en and pt-BR, links); acceptance `@AGR-08`; the page URL SignPath is given                   |
| AGR-09         | The note follows the signing   | Web component tests on the setting; acceptance `@AGR-09`                                                          |
| AGR-10         | Trust boundaries               | Harness tests on secrets, scripts, pins and the artifact id; the security reviewer                                |
| AGR-11         | The runbook                    | Review; `pnpm format:check`; a harness test that the runbook names each variable and secret the workflow reads    |

## Stories

- As a player, I want the installer I download to be the signed one from the first minute it is public, so that Windows
  does not warn me and I do not run something that is replaced a minute later (AGR-01, AGR-02, AGR-04).
- As a player with the agent installed, I want an update to either arrive whole or not at all, so that a bad release does
  not break my agent (AGR-03, AGR-06, AGR-07).
- As the maintainer, I want a failed signing request to leave a draft I can re-run, never a public half-release (AGR-02,
  AGR-06, AGR-11).
- As SignPath's reviewer, I want a policy page that says who approves a signing request and what the program does, so
  that I can accept the project (AGR-08).
- As a player reading the site, I want it to be honest about whether the installer is signed (AGR-09).

## Decisions (conservative defaults)

- **Publish in a new `publish` job**, not at the end of `sign`: it runs with `needs: [build, sign]` and
  `if: always() && needs.build.result == 'success' && (needs.sign.result == 'success' || needs.sign.result == 'skipped')`,
  so it works with signing on and off and never runs after a failed `sign`.
- **Signing is replaced in the draft, not in a public release.** `--clobber` stays, and stays confined to the `sign` job
  (the existing harness test keeps saying so), but it now acts on a draft, which is not visible to `releases/latest`.
- **The checker is a Node script** (`scripts/agent/release-assets.mjs`) beside `latest-json.mjs`, tested with `node --test`;
  it reads the asset files the job downloaded, never the network.
- **The Authenticode check is a PowerShell step** (`Get-AuthenticodeSignature`) whose verdict goes through a tested Node
  helper that decides pass or fail from `Status` and the signer's subject; the expected subject is the repository variable
  `SIGNPATH_PUBLISHER`.
- **The policy page is a view of the site** at `/code-signing` (a path, not a hash, because SignPath's reviewers open it by
  URL), with its strings in the two locale files (rule 9). Its roles come from one typed list, so the page and the README
  read the same names.
- **The unsigned SmartScreen note is driven by one build-time site setting** (`VITE_INSTALLER_SIGNED`, default `false`),
  read in `main/`-style config like the rest of the site's environment (rule 13).
- **No new ADR.** ADR 015 and ADR 016 already decide the pipeline and the signer; this feature changes the order of jobs
  inside them and adds a page.

## Decisions from the review of batch 0 (orchestrator, 2026-11-20)

- **Roles on the policy page** are the maintainer's public GitHub handle for committer, reviewer and approver. The contact
  email waits for T9 (brief input 9).
- **`SIGNPATH_PUBLISHER`** is a repository variable (rule 13). While it is unset, the Authenticode check reports "not
  configured" and the publication of a signed release refuses; the unsigned flow (`SIGNPATH_ENABLED` not `true`) is unchanged.
- **`/code-signing` is served by the SPA fallback**, and this is proved, not assumed: Cloudflare Pages serves `index.html`
  for an unknown path when the project has no top-level `404.html` (Pages "Not found behavior"); the repository has no
  `_redirects` and no `404.html`, a harness test fails if either appears under `apps/web`, and the site's smoke stage
  (`scripts/delivery/smoke.mjs`) asks for `/code-signing` and needs a 200 HTML answer.
- **`VITE_INSTALLER_SIGNED`** is a build-time setting (rule 13), default `false`.
- **"An installed 0.3.0 is offered the update"** (AGR-07) stays the maintainer's field check, in batch 2.
- **Never in this feature's tasks:** creating a tag or a release, or running `release-agent.yml` for real. Tests only; the
  first real run is T8, after the phase merges.
