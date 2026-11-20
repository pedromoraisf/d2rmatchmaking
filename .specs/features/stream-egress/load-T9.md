# Stream egress — load before and after (T9, SEG-09)

Two full runs of the nightly's `load` suite (ADR 035), dispatched with `gh workflow run nightly.yml --ref <branch> -f suites=load`
(a cloud session cannot build the load images, so the load runs in GitHub Actions).

| Run    | Id          | Commit     | What it holds                                                                     |
| ------ | ----------- | ---------- | --------------------------------------------------------------------------------- |
| Before | 44784255075 | `b0db3770` | batch 1 (SEG-01 to SEG-08), no batch-2 cut; the nightly prints the egress numbers |
| After  | 44802474201 | `6c98aa01` | batch 1 and the three batch-2 cuts (SEG-03, T8)                                   |

The "before" run is the earliest commit of the branch that prints the numbers in the job log; the cuts came after it, so it
is the state of PR #99 as to the load journey. A run of `08e375c1` (PR #99's head then, 44802470080) also passed, but its
job log carries no numbers: the print step is from `b0db3770`, and the artifact host (`productionresultssa18.blob.core.windows.net`)
is not reachable from the cloud session.

The numbers below come from the print step of each job log. Both runs passed the 100-player minimum (NFR-14) and
`full-summary.check.mjs`.

## Total

| Measure                | Before  | After   | Change              |
| ---------------------- | ------- | ------- | ------------------- |
| `bytesPerPlayerHour`   | 429,398 | 405,334 | -24,064 (-5.6 %)    |
| `matchesPerPlayerHour` | 60.00   | 60.00   | the journey is held |
| NFR-14 target (about)  | 70,000  | 70,000  | still 5.8 times it  |

## Bytes per player-hour by event type

| Reader | Event                    | Before  | After   | Change  |
| ------ | ------------------------ | ------- | ------- | ------- |
| agent  | `room.assigned`          | 24,000  | 7,860   | -16,140 |
| agent  | `ready_check.started`    | 20,700  | 11,820  | -8,880  |
| agent  | `room.stage_changed`     | 6,000   | 6,000   | 0       |
| agent  | `ready_check.resolved`   | 6,120   | 6,120   | 0       |
| agent  | unlisted                 | 2,400   | 2,400   | 0       |
| site   | `room.stage_changed`     | 122,522 | 123,540 | +1,019  |
| site   | `room.member_changed`    | 28,320  | 28,320  | 0       |
| site   | `queue.updated`          | 24,060  | 24,060  | 0       |
| site   | `room.assigned`          | 24,000  | 24,000  | 0       |
| site   | `ready_check.started`    | 20,700  | 20,700  | 0       |
| site   | `ready_check.updated`    | 20,640  | 20,640  | 0       |
| site   | `ready_check.resolved`   | 6,120   | 6,120   | 0       |
| site   | unlisted                 | 2,400   | 2,400   | 0       |
|        | other (non-stream bytes) | 121,414 | 121,354 | -60     |

`room.run_opened` is 0 in both: the journey does not open a second run. Its cut (about 340 bytes an event) is held by the unit
test only. The site's `room.stage_changed` differs by 0.8 %, within the spread between two runs.

## Bytes by step (the ladder's players, whole step)

Metered bytes of each step (the two stream readers and the rest), before and after. The cuts hold at every step.

| Players | Before    | After     | Change | Of which not the streams (after) |
| ------- | --------- | --------- | ------ | -------------------------------- |
| 25      | 275,289   | 259,477   | -5.7 % | 78,447                           |
| 50      | 532,936   | 507,210   | -4.8 % | 154,504                          |
| 100     | 1,073,482 | 1,013,334 | -5.6 % | 303,384                          |
| 150     | 1,597,036 | 1,508,472 | -5.5 % | 449,100                          |
| 200     | 2,146,100 | 2,020,400 | -5.9 % | 607,300                          |
| 300     | 3,195,840 | 3,002,880 | -6.0 % | 900,230                          |
| 400     | 4,240,795 | 4,015,928 | -5.3 % | 1,205,836                        |

## What is left

The two agent cuts took 25,020 bytes. The remaining weight is the site's `room.stage_changed` (123,540, with the member list
in every stage change), the non-stream bytes (121,354) and the other site events with their member lists. The next cuts are
a lean site `room.stage_changed` (a change to the site's reducer) and the member `characterId` and `team` fields
(`docs/engineering/stream-events.md`); the 70,000 target needs both and more.

## Proposed ceiling and baseline

`load.bytes_per_player_hour`: baseline **405,300**, ceiling **447,000** (F1 held 465,000 over 421,400, a ratio of 1.103).
`.quality-baseline.json` is not touched here; the maintainer applies it (SEG-09, rule 4). The row is in
`.specs/phases/F2/decisions.md` under "To confirm".
