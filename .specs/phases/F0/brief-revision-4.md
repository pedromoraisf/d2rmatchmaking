# Phase F0 — Brief revision 4

**Status**: APPLIED to `brief.md` on 2026-11-05. Approved by the maintainer: "Pelo fluxo da fase", answering how to fix the site defect below after the runner offered the phase flow as the option that adds this feature to F0.
**Why**: the first runs on GitHub of `phase/F0` (PR 11, commit `c7a4dda`) failed `integration` on `@AWS-23`: the site stayed on "Awaiting host" after the agent reported the game name. The defect is in the site, so `ci-and-review-fixes`, which keeps product behaviour out of scope, cannot hold the fix.

## 1. New feature row

| Feature             | Size  | Depends on          | Parallel | Covers          | Wall-clock |
| ------------------- | ----- | ------------------- | -------- | --------------- | ---------- |
| site-stale-read-fix | Small | ci-and-review-fixes | no       | NFR-01, ADR 007 | default    |

No new exit criterion. The feature lets the CI proofs of existing criteria 1, 9 and 11 stop depending on the timing of one race.

## 2. Scope of the feature (sketch for its Specify; the runner writes the requirement IDs)

- **Problem**: `refreshSite` in `apps/web/src/app/App.tsx` writes the result of a read over the site state. A read that started before the observation's commit can answer after the `room.stage_changed` event reached the site, and it puts the older stage back. In run `42053404931` the last `GET /v1/me/room` left at `20.601` and answered at `20.629` with `awaiting_host`, around an observation sent from `20.602` to `20.627`.
- **Evidence and its limit**: the trace, the stream hub and the relay support this order. The trace does not record the stream's content, so the event's arrival is inferred. The first task reproduces the order in a unit test: if that test does not fail on today's code, the feature stops and returns to the maintainer.
- **Change**: when a stream event arrives while a read is in flight, the site ignores that read and reads again. The event is published after the commit, so a read that starts after it sees that commit.
- **Proof**: unit tests on `App` with a held answer, and acceptance scenarios that hold the browser's answer until the event has arrived.

## 3. Out of scope

- Two overlapping reads answering out of order, with no stream event involved: nothing has failed on it, and it stays a risk in `review.md`.
- Any API, contract or stream change.
- Making `integration` or `agent` required checks on `main`: the maintainer's decision, listed in `review.md`.

## Approval

**Approved**: 2026-11-05 - user: "Pelo fluxo da fase"
