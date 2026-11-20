# ADR 033 — Delivery platform: uniform environments and stages for the site, the API and the agent

**Status**: Accepted
**Date**: 2026-11-20 (accepted 2026-11-20 by the maintainer, with the Batch 3 amendment in force: "aceito")
**Deciders**: maintainer
**Supersedes**: none (extends 030 and 032; changes the deploy shape of 028 § 1 only in where its steps live)

## Context

Each app ships its own way. Render builds the API from source on each deploy hook, so there is no artifact and no
check of which build answers. The site is built once and then patched per deploy. The agent is released only by tag,
and its per-PR test installer points at the `main` API. One Render service, `d2rmm-api`, serves staging and
production with the staging Battle.net credentials (F1 decisions, 2026-11-12; ADR 032 names the split as F2 work).
Previews exist only for labelled PRs into `main` (ADR 030), and the free API sleeps, so the first visitor gets a 502.
The maintainer asked for uniform environments and pipelines with uniform, well-structured stages (2026-11-20).

## Decision

1. **Environments**: _preview_ (per PR), _staging_ (every commit on `main`) and _production_ (promotion of a commit
   that passed staging smoke), for the site, the API and the agent. Staging keeps today's Render service, URL and
   data; production is a new service, so nothing moves under staging's users.
2. **Stages**: build → verify → deploy → smoke → promote, as reusable workflows (`stage-build`, `stage-deploy`,
   `stage-smoke`, `stage-promote`) with one thin caller per app (`site.yml`, `api.yml`, `agent.yml`). Jobs are always
   named `build`, `verify`, `deploy`, `smoke`, `promote`. `verify` reads the existing `ci` run for the SHA; it does
   not re-run it.
3. **Build once** (ADR 032 V, X): each app builds its artifact once per commit, identified by the SHA, and deploy and
   promote use that artifact without rebuilding. Site: `dist`. API: a prebuilt image if Render's free plan allows it
   (see Render's answer below), otherwise a pinned commit, a deviation recorded here. Agent: one build per channel,
   which ADR 032's agent exception allows.
4. **Config only from the environment** (ADR 032 III). The site's preview API origin becomes deploy configuration
   (`preview-origin.json` written at deploy), not a patch to the built bundle. The API reads `D2RMM_BUILD_SHA`
   (fallback `RENDER_GIT_COMMIT`) in `main/` only, answers it on `/healthz` and sets it as `service.version`. Every
   smoke stage wakes the service (backoff up to 90 s) and fails when the answering SHA differs from the deployed one.
5. **Staging and production are separate** Render services, Neon databases, Battle.net clients, `D2RMM_ENV` values
   and site URLs. `render.yaml` declares both with every secret as `sync: false`. Migrations run as a release step per
   environment (ADR 032 V, XII). Nothing costs beyond the free tiers (NFR-07).
6. **Secrets** reach only the `deploy` and `promote` jobs, through the GitHub environments `preview`, `staging` and
   `production`, which the maintainer creates (ADR 028 § 1, rule 7).
7. **Promotion** is a `workflow_dispatch` of `stage-promote` on a SHA that passed staging smoke, started by the runner
   (ADR 028). It needs no reviewer.
8. **Agent channels**: preview, staging and production, each with its own identifier and product name so they install
   side by side. The updater is on only in production (ADR 015). Preview and staging installers are workflow artifacts,
   never GitHub Releases (the `releases/latest` rule), and each is smoke-started with `--self-check --online` against
   its channel's API before upload (lessons, 2026-11-19). Windows signing stays as ADR 016.
9. **Awake window**: production stays awake only in a configured daily window (default 16:00–02:00
   `America/Sao_Paulo`, about 310 h a month), within Render's 750 free instance-hours with staging and previews. The
   site retries a 502/503 from a sleeping API with a "waking the server" message for up to 90 s.
10. **Phase previews** use one fixed Pages alias, so a single redirect URL is registered at Blizzard.
11. **Strangler** (gradual change): each new workflow runs beside the one it replaces and the old one is removed only
    after three real runs. `ci.yml`, `nightly.yml` and `ocr-real.yml` do not change.

### Render and prebuilt images (DLP-01)

A Render web service can deploy a prebuilt image from a registry, including GitHub Container Registry; public images
work from any reachable registry, and the Docker hosting page lists a free tier of 750 instance-hours. Image-based
services do not auto-deploy, so a deploy is triggered explicitly, and Render pulls the image on every deploy, so the
tag must stay in the registry. Sources: https://render.com/docs/deploying-an-image and
https://render.com/hosting/docker. **Verification level**: read through a web search summary; the pages themselves
were not reachable from the worker's network (HTTP 403 from the egress proxy), so the claim that the **Free** instance
type specifically accepts an image is **unverified** until Batch 3. Fallback if it does not: pin the commit and let
Render build that exact commit (deviation from "build once", recorded here at that time).

#### Amendment 2026-11-20 (Batch 3): the API deviates from build once

The fallback is in force. The ADR was accepted with this amendment (see the date line).

- **Factor V is broken for the API** (ADR 032 V, one build per release). Render builds the pinned commit from source,
  twice: once for `d2rmm-api` (staging) and once for `d2rmm-api-production`. The two builds are not byte-identical
  artifacts of one build. `stage-build` only compiles the API and uploads the commit pin (`api-<sha>`); no image or
  bundle is promoted. The site keeps build once (its `dist` is promoted unchanged).
- **Image support was not verified.** Whether the Free instance type runs a prebuilt image could not be checked in
  Batch 3: `render.com` was unreachable from the cloud session (`getaddrinfo ENOTFOUND render.com`).
- **Mitigation: the SHA-checked smoke.** Every deploy waits (up to 10 minutes) until `/healthz` answers the SHA that was
  deployed, and the smoke stage fails otherwise. Production runs the same check on promotion, so a build that is not the
  verified commit is never reported as promoted.
- **The deploy hook's `&ref=` is unverified.** The workflows pass the commit to deploy as `ref` on the hook URL. If Render
  ignores it, it builds its branch head, the answering SHA differs from the deployed one and the SHA smoke **fails
  loudly**. The first staging deploy proves it, and the first production promotion needs the same proof before it is
  trusted.
- **Condition to return to a prebuilt image.** The maintainer (or a session with `render.com` reachable) confirms in
  Render's docs that a Free web service runs an image from a registry (e.g. a public GHCR image) and how a deploy hook
  names the image tag. Then `stage-build` pushes `ghcr.io/<owner>/d2rmm-api:<sha>`, both services deploy that image, the
  hook carries the image instead of `ref`, and this amendment is superseded by a new one.

## Alternatives considered

- Keep one Render service for both environments: the staging credentials would serve production, and one deploy
  would risk both.
- Rebuild per environment: two builds of one commit can differ (ADR 032 V).
- A paid always-on instance: breaks NFR-07.
- A cron ping around the clock: exceeds 750 h with staging and previews.

## Consequences

- One run reads the same for every app, and the maintainer can ask any environment which commit answers.
- The maintainer creates environments, the second Render service, the production Neon database and the Battle.net
  client (runbook, § What the maintainer creates); the API split waits for them.
- The free API still wakes in 30–60 s; the site and the smoke stages now expect it.
- Revisit: the image path if Render's free plan does not take images; the awake window after the first month of hours.
