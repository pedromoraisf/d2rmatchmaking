# Delivery platform — Design

The full target goes in ADR 033 (Proposed) and `docs/engineering/delivery.md`. This file fixes the shape the tasks
follow.

## Environments × apps

| App   | preview (per PR)                                                        | staging (`main`)                                           | production (promotion)                                       |
| ----- | ----------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| site  | Pages branch deploy; proxy to the PR's preview API, or staging          | Pages alias `staging` → staging API                        | Pages production → production API                            |
| API   | Render PR preview with its own Neon branch (ADR 030, unchanged in kind) | Render `d2rmm-api` (today's service, `D2RMM_ENV=staging`)  | new Render `d2rmm-api-production` (`D2RMM_ENV=production`)   |
| agent | installer artifact, identifier `com.d2rmm.agent.preview`, updater off   | installer artifact, `com.d2rmm.agent.staging`, updater off | release-please GitHub Release, `com.d2rmm.agent`, updater on |

Staging keeps the current service, URL and data. Production is the new service, so nothing moves under live users of
staging.

## Stages (reusable workflows)

```text
.github/workflows/
  stage-build.yml     workflow_call(app, sha)              → artifact <app>-<sha>
  stage-deploy.yml    workflow_call(app, env, sha)         → deploys the artifact; migrations first for the API
  stage-smoke.yml     workflow_call(app, env, sha, url)    → wake (≤ 90 s) then check: /healthz sha, page, --self-check
  stage-promote.yml   workflow_call(app, sha)              → deploy + smoke on production with the same artifact
  site.yml · api.yml · agent.yml                           → thin callers: triggers and inputs only
  keep-awake.yml      schedule every 10 min, inside the window (DLP-07)
```

- Job names are always `build`, `verify`, `deploy`, `smoke` and `promote`. `verify` is the existing `ci` run for that
  SHA, read with `gh run list`; it is not re-run.
- Secrets reach only `deploy` and `promote`, through GitHub environments `preview`, `staging` and `production`. The
  maintainer creates the environments (rule 7); until then the old repository-level secrets keep working.
- **Site artifact**: `dist`. The preview API origin becomes deploy configuration: the deploy writes a
  `preview-origin.json` beside the functions, and `[[path]].ts` reads it through the existing validation (only
  `https://d2rmm-api-pr-<n>.onrender.com`). The built bundle is never patched.
- **API artifact**: first, the worker confirms in Render's docs whether a free web service can run a prebuilt image
  from GHCR (public). If it can, `stage-build` pushes `ghcr.io/<owner>/d2rmm-api:<sha>` and both services deploy that
  image. If not, the services build from a pinned commit, and ADR 033 records the deviation.
- **Agent artifacts**: one Tauri build per channel, as ADR 032's exception allows. `D2RMM_API_BASE`, the identifier and
  the product name are set from the channel at build time, and the updater is compiled out outside production. The
  self-check line carries `channel` and `version`.

## API changes (small)

- `main/config.ts` reads `D2RMM_BUILD_SHA` (with `RENDER_GIT_COMMIT` as fallback) and passes it to `/healthz` and to the
  OTel resource as `service.version`. The domain and application layers are untouched.
- `/healthz` answers `{ status: "ok", version: "<sha>" }`. The contract is regenerated, and the Pages proxy still
  allows the path.
- The site gets a retry wrapper on its first API call: on a 502 or 503 it shows "waking the server" and retries with
  backoff for up to 90 s (DLP-07). The strings are in en and pt-BR.

## Keep-awake window (DLP-07)

`scripts/delivery/awake-window.mjs` exports `isInsideWindow(now, window)`, a pure function with unit tests, that the
workflow calls before pinging production's `/healthz`. The window comes from the variable `KEEP_AWAKE_WINDOW`
(`16:00-02:00 America/Sao_Paulo` by default). It crosses midnight.

## Order (each step a PR into `main`, merged when CI is green, then `main` merged into `phase/F2`)

1. ADR 033, `delivery.md`, `/healthz` version and the site retry.
2. Site: `stage-*` and `site.yml` beside `deploy-web.yml`, then remove `deploy-web.yml` after three green runs.
3. API: `render.yaml` with two services, then `api.yml` and `keep-awake.yml` beside `deploy-api.yml` and
   `preview-api.yml`. The production deploy waits for the maintainer's secrets.
4. Agent: the channels in the app crate, then `agent.yml` beside `ci.yml`'s `agent-build` artifact (which stays,
   frozen). `release-agent.yml` moves onto `stage-smoke` and `stage-promote` last.
5. Remove the replaced workflows and update their harness tests.
