# Delivery platform — Blockers

For the orchestrator to copy into the phase `decisions.md` (this branch has no `.specs/phases/F2/`).

## T5: site.yml smoke fails on a Cloudflare challenge (2026-11-20)

- **What failed**: the `smoke` job of `site.yml`, three pushes in a row (runs 44679257299, 44679714621, 44680179221).
  Build, verify and deploy are green and the page answers 200 HTML. `GET <preview>/api/healthz`, through the Pages
  proxy, answers 429 for the whole 90 s.
- **Last error**: `429 [server=cloudflare cf-mitigated=challenge]`, body `<title>Just a moment...</title>`: a
  Cloudflare managed challenge, not the API sleeping.
- **Attempts**: (1) first run, no detail in the message; (2) the message now shows status and body; (3) the message
  also shows headers and the smoke sends `user-agent: d2rmm-delivery-smoke`. None changed the answer.
- **Cause (not verified)**: a Cloudflare rule (Bot Fight Mode or a WAF rule) on the Pages zone, or Render's Cloudflare
  challenging the Function's request. Both are the maintainer's settings (rule 7).
- **Needs**: the maintainer to say whether the challenge is on the Pages zone or the Render origin, and to allow the
  runner's `/api/healthz` (for example a skip rule for that path, or a secret header the smoke sends). Then rerun.
