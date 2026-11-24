# Incident 2026-11-23 — staging could not be deployed or signed into

Status: open (closed when the phase/F2 staging deploy passes smoke and a sign-in on the staging site works).
Raised by the maintainer on 2026-11-23: "entendo essa situação como um incidente".

## Impact

- From 2026-11-22 every phase/F2 deploy of the staging API failed at "Migrate the database", so staging kept running
  #141 (`9476566e`) while the phase kept merging pull requests on top of it.
- The F2 exit criteria that need a live staging (T11 TraceQL line, T12 agent and site egress, the Windows field test)
  were blocked for about two days.
- The staging site (`staging.d2rmatchmaking.pages.dev`) could not sign in: the staging API sent the Battle.net callback
  to `d2rmatchmaking.pages.dev`, and the staging Battle.net client allowed only that address.
- No user was affected (nothing is launched). No data loss is known. Whether the staging and production database
  settings point at the same Neon database is still being checked (see actions).

## Timeline (UTC dates)

| When       | What                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-06 | One Neon project with one branch, named `production`, is created; the only API (`d2rmm-api`) uses it.                                                                |
| before F2  | `deploy-api.yml` deploys `d2rmm-api` with the secrets of the GitHub environment `production`.                                                                        |
| 2026-11-20 | delivery-platform splits staging and production. `delivery.md` says staging's secrets are "already set" at repository level; they never were.                        |
| 2026-11-21 | The GitHub environment `staging` is created for the staging bots, with variables only. `SITE_ORIGIN` there is the main site address.                                 |
| 2026-11-22 | #157: a push to `phase/**` deploys staging in the environment `staging`. First run 45051442469 fails: the database secret is not set. Recorded in F2 `decisions.md`. |
| 2026-11-23 | The maintainer adds production secrets. Reruns of api run 45205602828 still fail the same way. The Battle.net staging client has no staging redirect URL.            |

## Causes

1. **The environments were not created when the code that needs them merged.** The split (2026-11-20) and the phase
   deploy (#157, 2026-11-22) merged with a list of what the maintainer must create, not with the settings in place.
   Nothing failed the merge, so the gap only showed on the first real deploy.
2. **The docs described settings that did not exist.** `delivery.md` claimed repository-level staging secrets. In fact
   the old workflow had always deployed the staging service with the `production` environment's secrets, so the names
   "staging" and "production" meant different things in GitHub, Render and Neon.
3. **Staging had no site address of its own.** `render.yaml` kept `SITE_ORIGIN` at the main site "until the cutover",
   and the Battle.net staging client only had that address. The staging site existed, but nothing could sign in on it.
4. **The runner cannot see secrets or environments** (the proxy blocks those API paths, by design). Each check went
   through the maintainer, one question at a time, and one blocked item sat in `decisions.md` for a day without a
   date to chase it.
5. **The workflow never used the environment.** `stage-deploy`'s deploy job had no `environment:`, and a harness test
   pinned that ("staging uses repository secrets"), so the settings the maintainer put in the environment `staging`
   could never reach it. The orchestrator read `environment: staging` in the job log (an input value) as the job's
   environment and sent the maintainer to the wrong place twice. Fixed by naming the environment for staging deploys.

## Actions

| Action                                                                                                                                                        | Owner               | State              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ |
| `render.yaml`: staging `SITE_ORIGIN` = `https://staging.d2rmatchmaking.pages.dev`; same value set by hand in Render `d2rmm-api`                               | runner / maintainer | this PR / pending  |
| Battle.net staging client: add the `staging.` and `phase-preview.` callback URLs                                                                              | maintainer          | pending            |
| GitHub environment `staging`: the database secret, `RENDER_DEPLOY_HOOK`, `API_BASE_URL`; `SITE_ORIGIN` to the staging site                                    | maintainer          | pending            |
| Neon: give staging its own branch or project; confirm that the production secret does not point at the database staging uses                                  | maintainer          | pending            |
| `delivery.md` states where each staging setting really lives                                                                                                  | runner              | this PR            |
| Rerun the phase/F2 staging deploy; `/healthz` answers the phase head SHA                                                                                      | runner              | after the settings |
| Future: a feature that needs a new environment, secret or external client lands its settings checklist before merge, and its first real deploy is a task gate | runner              | lesson recorded    |
