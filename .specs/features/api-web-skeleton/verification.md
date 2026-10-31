# API and Web Skeleton verification

**Verdict**: FAIL
**Mutations**: 3 - probed C27 (offline boundary), C17 (rate-limit window), C38 (host-only game-name observation)
**Proofs**: `proofs.md` at 60c231f (HEAD 8f4fda0 differs by docs commits only)
**Verifier**: independent sub-agent (author != verifier)

## Findings

| Finding                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                            | Fix                                                                                                                           | Closed |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| C38's scenario never sends the observation from a non-host, so the host-only rule (AWS-24 AC 7, INV-06) is unproven at acceptance level | mutation `observation.accountId === this.hostAccountId` -> `true` at `apps/api/src/modules/lobby-room/domain/lobby-room.ts:174` survives the proof "An observation that does not prove the game leaves the room waiting"; its Examples (`acceptance.feature:266-269`) hold only "the host's agent" rows (another name, run 2). Only the unit test `lobby-room.test.ts:111` kills it | Add a non-host reporter case at acceptance level via a new tagged scenario (scenarios are not edited) and point a check at it |        |
