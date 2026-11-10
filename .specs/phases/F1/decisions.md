# Phase F1 — decisions

What the maintainer should see in the review. Routine decisions live in each feature PR's description.

## To confirm

| Feature       | Decision                                                                                                                                                                                         | Why                                                                                                                                                                 | Reversal cost                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| (all)         | A feature's spec, scenarios and tasks live on `feat/F1-<f>` and reach `phase/F1` with its PR; `phase-status` run on `phase/F1` shows such a feature as `specify` until it merges                 | `missingSteps: 'fail-on-gen'` fails every acceptance run while a committed `acceptance.feature` has no steps, so a spec on `phase/F1` would turn every other PR red | none (where the files are committed)                   |
| identity-bnet | OAuth through a small `fetch` adapter behind a `BattleNetOAuth` port instead of `openid-client` (Design Doc stack table); userinfo gives `sub` and BattleTag, no ID-token validation             | Three plain endpoints to fake in CI; fewer moving parts in the security review                                                                                      | swap the adapter                                       |
| identity-bnet | Sign-in, sign-out and revoke routes: `GET /v1/auth/bnet/login`, `GET /v1/auth/bnet/callback`, `POST /v1/auth/logout`, `DELETE /v1/agents/{id}`; always back to `/` after sign-in (no `returnTo`) | Design Doc routes; no open redirect                                                                                                                                 | additive routes                                        |
| characters    | Batch 1 (consent, capture, contracts, API, site, title table) runs before the screenshots; Batch 2 and the PR wait for them                                                                      | The brief stops the feature at its spec, but every later feature waits on `characters`; Batch 1 needs no screenshot                                                 | none (unmerged branch)                                 |
| characters    | The agent asks for capture consent in its window before any capture (CHR-01, CHR-02)                                                                                                             | AGENTS.md "never capture without consent"; F1 is the first live capture                                                                                             | remove the screen once the F4 installer consent exists |
| characters    | Live capture by `PrintWindow(PW_RENDERFULLCONTENT)` on the D2R window; exclusive fullscreen may read `UNKNOWN` until F2's cascade                                                                | Smallest first version of the brief's live capture                                                                                                                  | replace the adapter in F2                              |

## Blocked

| Feature / task | What failed | Last error | What each attempt changed | Options |
| -------------- | ----------- | ---------- | ------------------------- | ------- |

## Waiting on the maintainer

| Feature                     | Item                                                        | Asked      | Answer |
| --------------------------- | ----------------------------------------------------------- | ---------- | ------ |
| characters, agent-game-name | Screenshots of the character selection screen and automap   | 2026-11-10 |        |
| identity-bnet               | Battle.net OAuth client id and secret (staging, production) | 2026-11-10 |        |
