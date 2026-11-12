# ADR 030 — API pull request previews on Render, each with its own Neon branch

**Status**: Accepted
**Date**: 2026-11-11 (accepted 2026-11-11 by the maintainer: "aprovo a mudança. aceito o risco de custo também")
**Deciders**: maintainer
**Amends**: the deploy topology of the Design Doc (one Render API, built from `main`) and ADR 012 (the site reaches the
API through the Pages `/api/*` proxy): a site preview may now proxy to a preview API.

## Context

Only `main` is deployed to Render. A Pages preview of `phase/F1` showed the F1 site against the F0 API, so every F1
screen failed (`GET /v1/ready-checks/me` answered 404), and the maintainer could not try a phase before its review.
Render's single-service pull request previews give a PR its own temporary copy of a service, billed at the base
service's plan (free here), deleted when the PR closes (render.com/docs/service-previews). A preview copies the base
service's environment, so it would point at the staging database: the phase's migrations would either be missing or
alter staging for everyone. Neon branches are copies of the parent's data that store only their changes; the Free
plan allows 10 per project (neon.com/docs/introduction/plans).

## Decision

1. `render.yaml` sets `previews.generation: manual` on `d2rmm-api`. A PR into `main` gets a preview API
   (`d2rmm-api-pr-<n>`) only with the `render-preview` label. Manual, not automatic: Dependabot opens PRs into `main`
   and each would take one of the nine Neon branches available to previews.
2. A workflow on those PRs creates the Neon branch `preview/pr-<n>` from the project's default branch, migrates it,
   points the preview service's `DATABASE_URL` at it through the Render API, redeploys it, and waits for `/healthz`.
   It deletes the Neon branch when the PR closes; Render deletes the preview service.
3. A preview API refuses to start until its own database is set (`IS_PULL_REQUEST=true` without the preview marker
   the workflow sets), so its first boot, which inherits the staging `DATABASE_URL`, never touches staging.
4. The Pages preview of the PR's branch proxies `/api/*` to the preview API instead of the staging API.
5. Secrets: `NEON_API_KEY` and `RENDER_API_KEY` (repository secrets), `NEON_PROJECT_ID` (variable), set by the
   maintainer. No connection string is printed; the workflow masks it.

## Consequences

- A phase PR can be tried end to end on its own API and data before the review. Feature PRs into a phase branch get
  no API preview (Render previews only PRs into the linked branch, `main`).
- Cost: zero on the free plans, within Render's 750 free instance hours per month and Neon's 100 CU-hours; accepted
  by the maintainer. A preview sleeps after 15 minutes idle and takes about a minute to wake.
- Render documents no API field linking a preview to its PR; the workflow finds it by its parent service and name,
  verified on the first real run.
- The `render.yaml` change applies when it reaches `main` (Blueprint sync); until then the maintainer enables the same
  setting in the dashboard.
- A preview is a temporary, non-production instance of the same service; it does not amend ADR 006 (no second
  instance in the MVP means no second production instance).
- A preview inherits staging's other secrets (Battle.net client secret, session secret, OTLP token) and is publicly
  reachable. This is accepted at staging grade.
- The `render-preview` label can be applied by anyone with triage rights, and it makes jobs that hold secrets run the
  pull request head's code. Only same-repository pull requests are served, so a fork never gets a preview.
