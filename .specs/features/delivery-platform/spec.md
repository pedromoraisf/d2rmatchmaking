# Delivery platform — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (Complex) · **Security review**: yes
(workflows, secrets scoping, environments, the Pages proxy, agent channels)

## Problem

Each app ships its own way:

- **API**: built by Render from source on every deploy hook (`deploy-api.yml`). There is no artifact, and no check of
  which build answers.
- **Site**: built once, then patched per deploy by `preview.mjs bake`.
- **Agent**: released only by tag. The per-PR test installer points at the `main` API.

A single Render service, `d2rmm-api`, serves both staging and production with the staging Battle.net credentials
(F1 decisions, 2026-11-12). Previews exist only for labelled PRs into `main` (ADR 030). The free API sleeps, so the
first visitor gets a 502.

The maintainer asked for uniform environments and pipelines, with uniform, well-structured stages. They approved one
feature for it, whose PRs go straight to `main` (2026-11-20: "Aceito as duas recomendações").

## Requirements

- **DLP-01** — ADR 033 (Proposed) SHALL define the target, with `docs/engineering/delivery.md` as its runbook:
  - the environments **preview** (per PR), **staging** (every commit on `main`) and **production** (promotion of a
    staging-verified commit) for the site, the API and the agent;
  - the stages **build → verify → deploy → smoke → promote**, with each app's artifact per stage;
  - who triggers what.
- **DLP-02** — The stages SHALL be reusable workflows (`workflow_call`) shared by the three apps, with one thin caller
  per app. Every run SHALL name its jobs after the stages, so a run reads the same for every app.
- **DLP-03** — Each app SHALL build its artifact once per commit, identified by the commit SHA, and deploy and promote
  that artifact without rebuilding (ADR 032 V and X):
  - the site's `dist`;
  - the API, as an image or a commit pin;
  - the agent, with the per-channel builds ADR 032 allows.

  Configuration per environment SHALL come only from the environment. The site's preview API origin SHALL be deploy
  configuration, not a patch to the built bundle.

- **DLP-04** — The API's `/healthz` SHALL answer the build's commit SHA. It SHALL be read in `main/` from the
  environment and also set as the OpenTelemetry `service.version`. Every smoke stage SHALL wake the service (backoff
  up to 90 s) and SHALL fail when the answering SHA differs from the one deployed.
- **DLP-05** — Staging and production SHALL be separate:
  - Render services, Neon databases and Battle.net credentials;
  - `D2RMM_ENV`;
  - site URLs.

  `render.yaml` SHALL declare both services and every secret name as `sync: false`, including `BNET_CLIENT_ID` and
  `BNET_CLIENT_SECRET`. Migrations SHALL run as a release step per environment. Nothing SHALL cost beyond the free
  tiers (NFR-07).

- **DLP-06** — The agent SHALL have the channels **preview** (per agent PR, pointing at the staging API or the PR's
  preview API), **staging** (from `main`) and **production** (release-please, ADR 015):
  - each channel with its own identifier and product name, so they install side by side;
  - the updater on only in production;
  - preview and staging installers published only as workflow artifacts, never as GitHub Releases (the
    `releases/latest` rule);
  - every installer smoke-started with `--self-check --online` against its channel's API before upload, with the
    self-check line carrying the channel and the version.
- **DLP-07** — Production SHALL stay awake within Render's 750 free instance-hours a month, together with staging and
  the previews. A scheduled ping SHALL keep it awake only inside a configured daily window. The site SHALL retry a 502
  from a sleeping API with a "waking the server" message, for up to 90 seconds.
- **DLP-08** — Phase previews SHALL use one fixed Pages alias, so the maintainer registers a single redirect URL at
  Blizzard (F1 `handoff.md`).
- **DLP-09** — The change SHALL be gradual. Each new workflow runs beside the one it replaces; the old one is removed
  only after the new one has passed three real runs, recorded in the PR. The order is: the site, the API with the
  split, then the agent. `ci.yml` (its required checks and their names), `nightly.yml` and `ocr-real.yml` SHALL NOT
  change.
- **DLP-10** — Every new or changed workflow SHALL have a static harness test in `scripts/test/` covering:
  - triggers;
  - secrets scoped to the deploy jobs through `env`;
  - no `${{ }}` inside `run`;
  - actions pinned by full SHA;
  - the stage names;
  - the smoke stage coming before any promote stage.

## Sources

| ID     | Source                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- |
| DLP-01 | brief, delivery-platform notes; maintainer 2026-11-20                                    |
| DLP-02 | maintainer ("pipelines uniformes, etapas uniformes e bem estruturadas")                  |
| DLP-03 | ADR 032 (III, V, X and the agent exception); NFR-08                                      |
| DLP-04 | ADR 032 V; lessons (Render wakes in 30–60 s); NFR-09                                     |
| DLP-05 | F1 decisions 2026-11-12 (split moved to F2); NFR-07; ADR 005; F1 `handoff.md` (`BNET_*`) |
| DLP-06 | F1 decisions 2026-11-12 (agent channels); ADR 015; FR-29; lessons (self-check first)     |
| DLP-07 | brief input 4 (option a, approved); `docs/engineering/constraints.md` (750 h)            |
| DLP-08 | F1 `handoff.md` (one fixed Pages alias); ADR 030                                         |
| DLP-09 | brief, delivery-platform notes (strangler, frozen files)                                 |
| DLP-10 | ADR 028 (required checks are the safety net); existing `deploy-workflows.test.mjs`       |

## Requirement Traceability

| Requirement ID | Story        | Proof                                                                             |
| -------------- | ------------ | --------------------------------------------------------------------------------- |
| DLP-01         | Target       | ADR 033 and `delivery.md` in review                                               |
| DLP-02         | Stages       | harness tests on the reusable workflows and callers                               |
| DLP-03         | Build once   | harness tests (no build in deploy or promote jobs) + run links                    |
| DLP-04         | Version      | API unit and integration tests + acceptance `@DLP-04` + smoke run links           |
| DLP-05         | Split        | the two `/healthz` answers + harness test on `render.yaml`                        |
| DLP-06         | Channels     | Rust unit tests on channel config + harness test + an agent PR artifact           |
| DLP-07         | Awake        | unit test on the window rule + site component test + harness test on the schedule |
| DLP-08         | Alias        | unit test on the alias rule + the maintainer's Blizzard check                     |
| DLP-09         | Strangler    | the PR descriptions with three run links per replaced workflow                    |
| DLP-10         | Static tests | `pnpm test:harness`                                                               |

## Decisions (conservative defaults; listed in `decisions.md → To confirm`)

- **Promotion to production** is a `workflow_dispatch` of the promote stage on a SHA that passed staging smoke, started
  by the runner (ADR 028). It needs no reviewer.
- **The API artifact.** Render free services deploy a prebuilt image if the docs confirm it; otherwise the commit is
  pinned and Render builds that exact commit, and ADR 033 records the deviation from "build once".
- **The keep-awake window** defaults to 16:00–02:00 in São Paulo (10 h a day, about 310 h a month), leaving room for
  staging and previews within 750 h. The maintainer may change it with a variable.
- **The maintainer's part** (rule 7): creating the GitHub environments, the second Render service, the production Neon
  database and Battle.net client, and their secrets. The local lane prepares the exact list. The feature waits on them
  only for the API split.
