# Delivery

Runbook for [ADR 033](../adr/033-delivery-platform.md) (Proposed). It describes the target; sections marked _planned_
are built by the batches of `.specs/features/delivery-platform/tasks.md`.

## Environments

| App   | preview (per PR)                                   | staging (`main`)                             | production (promotion)                 |
| ----- | -------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| site  | Pages branch deploy; proxy to the PR's preview API | Pages alias `staging` → staging API          | Pages production → production API      |
| API   | Render PR preview with its own Neon branch (030)   | Render `d2rmm-api`, `D2RMM_ENV=staging`      | Render `d2rmm-api-production`          |
| agent | installer artifact `com.d2rmm.agent.preview`       | installer artifact `com.d2rmm.agent.staging` | GitHub Release `com.d2rmm.agent` (015) |

## Stages

`build → verify → deploy → smoke → promote`. Reusable workflows `stage-build`, `stage-deploy`, `stage-smoke`,
`stage-promote` (_planned_), called by `site.yml`, `api.yml`, `agent.yml`. Job names are always the stage names.

| Stage   | Does                                                                                         | Triggered by         |
| ------- | -------------------------------------------------------------------------------------------- | -------------------- |
| build   | one artifact per commit, named by SHA                                                        | push, PR             |
| verify  | reads the `ci` run for the SHA (`gh run list`); never re-runs it                             | after build          |
| deploy  | deploys that artifact to the environment; API migrations first; secrets only here            | after verify         |
| smoke   | wakes the service (backoff ≤ 90 s), then checks `/healthz` SHA, the page, `--self-check`     | after deploy         |
| promote | `workflow_dispatch` on a SHA that passed staging smoke; deploys the same artifact, smokes it | the runner (ADR 028) |

## Which build answers

`GET /healthz` answers `{ "status": "ok", "version": "<sha>" }`. The SHA comes from `D2RMM_BUILD_SHA`, falling back
to `RENDER_GIT_COMMIT`, read only in `apps/api/src/main/config.ts`; the same value is the OpenTelemetry
`service.version`. A smoke stage fails when the answering SHA differs from the deployed one. Without either variable
the answer is `unknown`.

## Sleeping API

The free API sleeps after 15 minutes idle and wakes in 30–60 s. The site shows "waking the server" and retries a
502/503 with backoff for up to 90 s. Production stays awake only inside `KEEP_AWAKE_WINDOW` (default
`16:00-02:00 America/Sao_Paulo`, about 310 h a month) so staging and previews fit in 750 free instance-hours
(`constraints.md`). _Planned_: `keep-awake.yml`.

## Render and prebuilt images

Render documents prebuilt-image deploys from GHCR (https://render.com/docs/deploying-an-image), with no auto-deploy
and a pull on every deploy. Whether the **Free** instance type accepts one is unverified (the docs were not reachable
from the worker's network); Batch 3 settles it. Fallback: pin the commit and let Render build it (ADR 033).

## Rules

- `ci.yml`, `nightly.yml`, `ocr-real.yml` are frozen. A new workflow runs beside the one it replaces for three real
  runs before the old one goes (DLP-09).
- Secrets only in `deploy` and `promote`, through `env`; no `${{ }}` inside `run`; actions pinned by full SHA.
- Environments, Render services, Neon databases and the Battle.net client are the maintainer's (rule 7).

## What the maintainer creates

_Planned_ (Batch 3, T8).
