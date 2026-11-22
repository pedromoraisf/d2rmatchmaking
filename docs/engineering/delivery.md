# Delivery

Runbook for [ADR 033](../adr/033-delivery-platform.md) (Proposed). It describes the target; sections marked _planned_
are built by the batches of `.specs/features/delivery-platform/tasks.md`.

## Environments

| App   | preview (per PR)                                   | staging (`main`)                             | production (promotion)                 |
| ----- | -------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| site  | Pages branch deploy; proxy to the PR's preview API | Pages alias `staging` → staging API          | Pages production → production API      |
| API   | Render PR preview with its own Neon branch (030)   | Render `d2rmm-api`, `D2RMM_ENV=staging`      | Render `d2rmm-api-production`          |
| agent | installer artifact `com.d2rmm.agent.preview`       | installer artifact `com.d2rmm.agent.staging` | GitHub Release `com.d2rmm.agent` (015) |

The agent's production release is public only after it is signed (when signing is on) and its assets are checked as a set:
build, then sign, then publish, in [`releases.md`](releases.md). Preview and staging installers are never GitHub Releases.

## Stages

`build → verify → deploy → smoke → promote`. Reusable workflows `stage-build`, `stage-deploy`, `stage-smoke`,
`stage-promote`, called by `site.yml` and `api.yml` (built) and `agent.yml` (_planned_); `release-agent.yml` already
calls `stage-smoke`. Job names are always the stage names.

| Stage   | Does                                                                                         | Triggered by         |
| ------- | -------------------------------------------------------------------------------------------- | -------------------- |
| build   | one artifact per commit, named by SHA                                                        | push, PR             |
| verify  | reads the `ci` run for the SHA (`gh run list`); never re-runs it                             | after build          |
| deploy  | deploys that artifact to the environment; API migrations first; secrets only here            | after verify         |
| smoke   | wakes the service (backoff ≤ 90 s), then checks `/healthz` SHA, the page, `--self-check`     | after deploy         |
| promote | `workflow_dispatch` on a SHA that passed staging smoke; deploys the same artifact, smokes it | the runner (ADR 028) |

## Staging during a phase

During a phase, staging follows `phase/<F>`: a push to `phase/**` that touches the API runs build → deploy → smoke
against staging with the repository-level staging secrets, with no `API_STAGES_LIVE` needed, and the Render service
points at that branch. `stage-deploy`'s `verify` needs a green `ci` run of the pushed SHA, and a merge into `phase/<F>` creates a SHA that no
pull request ran, so `ci.yml` also runs on a push to `phase/**` (its concurrency group is per ref, so a superseded run is
cancelled). Pushes share one serial group (nothing is cancelled). When the phase merges into `main`, staging
follows `main` again and the Render service branch goes back to `main`. A phase push never reaches `production`:
promotion stays a dispatch of `main`.

## Which build answers

`GET /healthz` answers `{ "status": "ok", "version": "<sha>" }`. The SHA comes from `D2RMM_BUILD_SHA`, falling back
to `RENDER_GIT_COMMIT`, read only in `apps/api/src/main/config.ts`; the same value is the OpenTelemetry
`service.version`. A smoke stage fails when the answering SHA differs from the deployed one. Without either variable
the answer is `unknown`.

## Sleeping API

The free API sleeps after 15 minutes idle and wakes in 30–60 s. The site shows "waking the server" and retries a
502/503 with backoff for up to 90 s. Production stays awake only inside `KEEP_AWAKE_WINDOW` (default
`16:00-02:00 America/Sao_Paulo`, about 310 h a month) so staging and previews fit in 750 free instance-hours
(`constraints.md`). `keep-awake.yml` pings `PRODUCTION_API_URL/healthz` every ten minutes, only inside the window
(`scripts/delivery/awake-window.mjs`); with the variable unset it does nothing.

## Render and prebuilt images

Render documents prebuilt-image deploys from GHCR (https://render.com/docs/deploying-an-image), with no auto-deploy
and a pull on every deploy. Whether the **Free** instance type accepts one is unverified (the docs were not reachable
from the worker's network, again in Batch 3: `getaddrinfo ENOTFOUND render.com`). So the API **uses the fallback**: the
commit is pinned and Render builds exactly that commit (the deploy hook takes it as `ref`, also unverified against the
docs; the first real staging deploy proves it). `stage-build` for the API compiles it and uploads the pin
(`api-<sha>`); the build-once deviation stays recorded in ADR 033. If the maintainer confirms that the free plan runs a
prebuilt image, only `stage-build` and the deploy step change.

## Staging bots

A lone tester fills a group with synthetic players on staging only: see [`staging-bots.md`](staging-bots.md).

## Rules

- `ci.yml`, `nightly.yml`, `ocr-real.yml` are frozen. A new workflow runs beside the one it replaces for three real
  runs before the old one goes (DLP-09).
- Secrets only in `deploy` and `promote`, through `env`; no `${{ }}` inside `run`; actions pinned by full SHA.
- Environments, Render services, Neon databases and the Battle.net client are the maintainer's (rule 7).

## What the maintainer creates

Everything here is the maintainer's (rule 7). The runner has written the code for it and **stops here until these exist**.
Names only, never values. Nothing below costs money: every service and database stays on a free tier (NFR-07).

### 1. Render

- Create the service **`d2rmm-api-production`** from `render.yaml` (Blueprints → sync; plan Free, region Virginia, auto
  deploy off). `d2rmm-api` (staging) already exists. Both declare the same secret names, to be filled in Render:
  `DATABASE_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`.
- Copy the **deploy hook URL** of each service (Settings → Deploy Hook).
- **`SITE_ORIGIN` of `d2rmm-api-production`** is a secret name too (`sync: false`): set it in Render to the exact
  origin of the production site, `https://d2rmatchmaking.pages.dev`. The file never names it, so production cannot
  inherit staging's. Staging's `SITE_ORIGIN` stays `https://d2rmatchmaking.pages.dev` in `render.yaml` until the
  cutover (item 5).

### 2. Neon

- A second database (a new project or branch) for **production**. Staging keeps today's. Its connection string is a
  secret; the runner never reads it.

### 3. Battle.net

- A separate OAuth client for production (staging keeps the existing client). Redirect URLs:
  - production client: `https://d2rmatchmaking.pages.dev/api/v1/auth/bnet/callback`;
  - staging client: `https://staging.d2rmatchmaking.pages.dev/api/v1/auth/bnet/callback` and
    `https://phase-preview.d2rmatchmaking.pages.dev/api/v1/auth/bnet/callback` (the one fixed phase alias, DLP-08).
- Put each client's id and secret in the matching Render service's `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET`.

### 4. GitHub

| Where                                 | Kind     | Name                                         | Value is                                                                                    |
| ------------------------------------- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| environment `production` (exists)     | secret   | `NEON_DATABASE_URL`                          | the production Neon connection string                                                       |
| environment `production`              | secret   | `RENDER_DEPLOY_HOOK`                         | the deploy hook of `d2rmm-api-production`                                                   |
| environment `production`              | variable | `API_BASE_URL`                               | the production service URL (https origin)                                                   |
| environment `production`              | variable | `D2RMM_ENV`                                  | `production` (the marker a promotion requires, see below)                                   |
| repository (already set, for staging) | secret   | `NEON_DATABASE_URL`, `RENDER_DEPLOY_HOOK`    | staging's; keep them                                                                        |
| repository (already set, for staging) | variable | `API_BASE_URL`                               | the staging service URL; keep it                                                            |
| repository                            | variable | `PRODUCTION_API_URL`                         | the production service URL, an `https://` origin (anything else is ignored), for keep-awake |
| repository                            | variable | `KEEP_AWAKE_WINDOW` (optional)               | `HH:MM-HH:MM <IANA zone>`; default 16:00-02:00 America/Sao_Paulo                            |
| repository                            | variable | `API_STAGES_LIVE` (set last, at the cutover) | `true`                                                                                      |

The environments `staging` and `preview` are optional: when they exist, `stage-deploy` gets an `environment:` and the
staging secrets move into them. Inside `production`, the environment's secret wins over the repository one of the same
name, which is how a promotion reaches production's database and service with the same workflow.
`D2RMM_ENV=production` exists only in that environment. The promote job fails before it migrates or deploys unless
it reads that value, so a missing production secret can never fall back to staging's repository-level one.

### 5. Cloudflare Pages

- Pages variable `API_ORIGIN`, per Pages environment: _Production_ → the production service URL; _Preview_ → the
  staging service URL. Nothing else changes in Pages.
- At the cutover, set staging's `SITE_ORIGIN` to `https://staging.d2rmatchmaking.pages.dev` (the next change to
  `render.yaml` records it).

### Cutover order (once 1 to 4 exist)

1. Set the two secrets and the variables (`API_BASE_URL`, `D2RMM_ENV=production`) in the environment `production`, and
   `PRODUCTION_API_URL` in the repository.
2. Dispatch `api` on `main` with the SHA of a commit whose staging run passed smoke: it migrates the production
   database, deploys that commit on `d2rmm-api-production` and waits for its `/healthz` to answer that SHA.
3. Point Pages _Production_ `API_ORIGIN` at the production service; dispatch `site` with the same SHA.
4. Set `API_STAGES_LIVE` to `true` and, in the same step, remove `deploy-api.yml` (Batch 5), or both would deploy a push
   to `main`. Until then `api.yml` builds and stops.
