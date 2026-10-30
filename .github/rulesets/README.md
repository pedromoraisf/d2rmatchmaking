# Repository rulesets

Versioned copies of the GitHub rulesets. Import each file in **Settings → Rules → Rulesets → New ruleset →
Import a ruleset**. If a ruleset changes on GitHub, export it and replace the file here (the maintainer owns them).

| File                      | Protects        | Rules                                                                                                                                                                                                                                           |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.json`               | default branch  | PR required (0 approvals: single maintainer), stale approvals dismissed, conversations resolved, **merge commits only**, required checks `verify` and `secrets` up to date with `main`, no force push, no deletion. No bypass, not even admins. |
| `phase-branches.json`     | `phase/**`      | no force push, no deletion                                                                                                                                                                                                                      |
| `agent-release-tags.json` | tags `agent-v*` | once created, a release tag is never moved or deleted (only repository admins bypass). Creation stays open so release-please (GitHub Actions) can tag; on this single-maintainer repo only you and Actions push tags anyway                     |

Why merge commits only on `main`: squash and rebase rewrite the phase branch's commits. The progress trailers
(`Feature:`, `Task:`, `Step:`) and the "phase merged into main" check of `pnpm phase:status` (ADR 024) rely on the
phase branch's commits being ancestors of `main`.

Required checks are the CI job names `verify` and `secrets` in `.github/workflows/ci.yml` — renaming a job breaks the
ruleset. Add `integration` and `agent` once `apps/api` and `apps/agent` exist (F0), by editing `main.json` and
re-importing.

`integration_id` 15368 is the GitHub Actions app (valid for required checks, but GitHub rejects it as a ruleset bypass
actor, so the tag ruleset leaves creation open). `actor_id` 5 with `RepositoryRole` is the Admin role.
