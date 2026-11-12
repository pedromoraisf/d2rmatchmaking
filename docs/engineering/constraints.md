# Engineering constraints

Hard limits the design must respect. A change that breaks one needs an ADR.

## Free-tier budgets (NFR-07)

| Resource           | Limit                                                                | Design consequence                                                                         |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Render web service | 512 MB RAM, fraction of a CPU, sleeps after 15 min idle, 750 h/month | One instance, in-process worker, in-memory stores; cold start acceptable off-peak          |
| Render egress      | 5 GB/month                                                           | ≤ ~70 KB per player-hour (NFR-14 at 100 players); minimal SSE payloads; adaptive heartbeat |
| Neon               | 1 GB storage, 100 CU-hours, scale-to-zero after 5 min                | No DB write per heartbeat; small pool; observations retained 30 days                       |
| Cloudflare R2      | free tier                                                            | Dispute prints only, 30-day lifecycle                                                      |
| GitHub Actions     | free for public repos                                                | Turborepo `--affected`; mutation in the nightly only (ADR 029)                             |
| Grafana Cloud      | free tier quotas                                                     | Head sampling; no high-cardinality attributes                                              |

## Performance

- NFR-01: room state change reaches the site ≤ 2 s after the agent's observation.
- NFR-02: agent < 2% CPU average, no perceptible FPS impact.
- NFR-14: ≥ 100 concurrent players on the main journey, verified by k6.

## Safety and privacy

- ADR 010: the agent's read-only boundary (see SECURITY.md).
- NFR-04/05: capture consent at install; prints only on player action; retention ≤ 30 days.
- NFR-06: agent token revocable and scoped; the agent accepts data, never commands.

## Portability

- NFR-08: changing host touches only `apps/api/src/main/` and workflow files.

## API previews

ADR 030. To try a pull request into `main` (a phase PR) on its own API and data, add the `render-preview` label.

- What it creates: the Render preview service `d2rmm-api-pr-<n>`, a Neon branch `preview/pr-<n>` of the default branch
  migrated with the PR's migrations, and the Pages preview of the PR's head branch with `/api/*` proxied to that
  preview API. `preview-api.yml` waits for `/healthz` (up to 10 minutes; the first boot of a preview builds the
  service) and writes both URLs in its step summary. Push more commits and it migrates and redeploys again.
- Until the workflow has set the preview's own `DATABASE_URL`, the API refuses to start (`IS_PULL_REQUEST=true` without
  `D2RMM_PREVIEW_DATABASE=ready`), so a preview never touches the staging database.
- Cleanup: closing the PR deletes the Neon branch (workflow) and the preview service (Render).
- Cost: free plans only. Neon Free allows 10 branches (one is the default, so keep at most nine labelled PRs open);
  a preview sleeps after 15 minutes idle and takes about a minute to wake. Dependabot PRs are not labelled, so they
  get no preview.
- Setup (maintainer): secrets `NEON_API_KEY`, `RENDER_API_KEY`; variable `NEON_PROJECT_ID`. Until `render.yaml` reaches
  `main`, enable previews (manual) on `d2rmm-api` in the Render dashboard.
- The preview API gets the preview site's own `SITE_ORIGIN` (the Pages alias of the head branch: `phase/F1` becomes
  `https://phase-f1.<project>.pages.dev`), so its same-origin check and sign-in redirects stay on the preview.
  `deploy-web.yml` and `preview-api.yml` bake the same upstream, so the last one to publish changes nothing.
