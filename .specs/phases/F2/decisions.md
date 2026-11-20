# Phase F2 — decisions

What the maintainer should see in the review. Routine decisions live in each feature PR's description.

## To confirm

| Feature           | Decision                                                                                                                                                        | Why                                                                                                                                                                                                                                                     | Reversal cost                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| delivery-platform | **Keep-awake window instead of 24/7**: production is pinged only 16:00–02:00 São Paulo (about 310 h/month), set by the variable `KEEP_AWAKE_WINDOW`             | Render's 750 free hours are per workspace: production awake 24/7 (about 730 h) would leave about 20 h for staging and previews, and free services are suspended when the hours run out. Brief input 4 said the 750 h would be confirmed before applying | change the variable                                    |
| delivery-platform | **Promotion to production** is a `workflow_dispatch` of the promote stage, run by the runner on a SHA that passed staging smoke, with no reviewer               | ADR 028 makes delivery the runner's; a reviewer would put the maintainer back in the loop                                                                                                                                                               | add required reviewers to the `production` environment |
| delivery-platform | **The API artifact**: a prebuilt GHCR image if Render's free tier runs one; otherwise a pinned commit, with the deviation from "build once" recorded in ADR 033 | ADR 032 V; Render builds from source today                                                                                                                                                                                                              | ADR 033                                                |
| nightly-report    | **No new ratchet metrics yet** for the agent domain and adapters mutation scores; the report shows them                                                         | `.quality-baseline.json` is the maintainer's (rule 4)                                                                                                                                                                                                   | add two metrics                                        |
| ocr-protection    | **`vocabulary.rs`, `vision.rs` and `name_diff.rs` are protected** with the reading modules                                                                      | they feed the reading; protecting them costs only tests                                                                                                                                                                                                 | edit `reading-modules.json`                            |

## Blocked

| Feature / task | What failed | Last error | What each attempt changed | Options |
| -------------- | ----------- | ---------- | ------------------------- | ------- |

## Waiting on the maintainer

| Feature           | Item                                                                                                                        | Asked      | Answer                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- |
| game-name-reading | The 7 Party prints, automap prints, and chat "joined"/"left" prints (brief, input 8)                                        | 2026-11-20 |                                         |
| capture-cascade   | The field matrix on 0.3.0, plus live normal and nightmare rooms (brief, input 8)                                            | 2026-11-20 |                                         |
| agent-release     | SignPath roles and contact email (brief, input 9)                                                                           | 2026-11-20 |                                         |
| all (cloud)       | Approve the cloud environment's setup script after the pilot (brief, input 10)                                              | 2026-11-20 |                                         |
| all (cloud)       | Install the Claude GitHub App on the repository: the cloud pilot's `git push` got 403 ("Claude doesn't have GitHub access") | 2026-11-20 | Installed 2026-11-20; cloud pushes work |
| delivery-platform | Restrict the `production` GitHub environment to `main` (repository setting; PR #84 security review)                         | 2026-11-20 |                                         |
| all (cloud)       | Answer the cloud pilot session directly: it will not install the Tauri apt libraries on another session's word              | 2026-11-20 | Done 2026-11-20; PR #86                 |
| nightly-report    | Accept ADR 035 (the nightly runs the load test); PR #85 applies it, so the phase PR waits for it                            | 2026-11-20 |                                         |
