# Phase F1 — handoff (2026-11-11)

The previous runner session stopped here because its context was full. `node scripts/phase-status.mjs F1` stays the
source of what is merged; this note lists what is in flight on branches, which phase-status does not see (a feature's
spec lives on its branch until its PR merges — `decisions.md → To confirm`, first row).

## Merged into `phase/F1`

identity-bnet (#43), characters (#44), site-shell (#45), agent-game-name (#48), queues (#51); harness fixes #46, #47,
#49.

## In flight

| Branch                       | State                                                                                                                                                                                                                                                                                                                                                            | Next step                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/F1-ready-check`        | T1–T8, T6, T7, T9 done and pushed (8e3184d). **T10 open**: RDY-04 failed 1 in 3 full runs (a site missed a ready-check stream event). A worker had uncommitted work on it (agent core re-read, hub, site) — saved as `/Users/pedromoraisf/www/d2rmatchmaking/.claude/worktrees/ready-check-T10-wip.patch` (outside the repo; review before applying). No PR yet. | Finish T10 (find the cause with evidence; 3 consecutive full `@RDY-\|@QUE-` runs 26/26), then open the PR into `phase/F1` with the architecture and security reviewers (new agent route, global hotkey).      |
| `feat/F1-lobby-rooms`        | Spec, design, scenarios and tasks committed (7a310c9). Not started.                                                                                                                                                                                                                                                                                              | After ready-check merges: merge `phase/F1` into it and dispatch Batch 1. It also proves AGN-05 end to end (LBR-06).                                                                                           |
| `feat/F1-characters-reading` | PR #50 open, **blocked** (T9, `decisions.md → Blocked`): Windows OCR does not read the drawn fixtures' small text. Blocks no other feature, only exit criterion 4.                                                                                                                                                                                               | The maintainer runs `node scripts/agent/ocr-check.mjs <folder>` on Windows with the real screenshots; then fix the fixtures' font or the regions on that evidence.                                            |
| `journeys-e2e`               | Not specified.                                                                                                                                                                                                                                                                                                                                                   | After lobby-rooms: J1/J2 end to end with headless agents, axe and keyboard on every screen (include site-shell review follow-ups: button border contrast, `.sr-only`), NFR-01 timing, load run ≥ 100 players. |

## How to resume

`/phase-run F1` in a new session. Read `docs/engineering/lessons.md` and `.specs/phases/F1/decisions.md` first. The
maintainer's English screenshots and the prototype were in the previous session's scratchpad: the screenshots are in
the upload `Prints_D2RMM.zip` and the two Party-panel images the maintainer attached; the prototype is the artifact
"D2R Match Making" (2026-10-30) — read it with the Artifact tool. Never commit a game screenshot.
