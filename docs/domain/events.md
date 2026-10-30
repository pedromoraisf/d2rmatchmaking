# Domain events

Written to `platform.outbox` in the same transaction as the state change (ADR 008), relayed in-process to the
`EventBus`, and projected to SSE where a client needs them. Consumers are idempotent by event id.

| Event                   | Publisher   | Consumers               | Payload (minimum)                                                                                             |
| ----------------------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AgentPresenceChanged`  | Agents      | Matchmaking, Lobby Room | agentId, accountId, online, gameRunning, screen                                                               |
| `MatchFormed`           | Matchmaking | Lobby Room              | matchId, mode, activity, difficulty, region, ladder, era, members[] (accountId, characterId, joinOrder, role) |
| `ReadyCheckFailed`      | Matchmaking | Matchmaking             | matchId, accepted[], declined[], timedOut[]                                                                   |
| `RoomAssignmentChanged` | Lobby Room  | Agents                  | roomId, run, expectedGameName, members[]                                                                      |
| `RoomStageChanged`      | Lobby Room  | SSE                     | roomId, stage, members[] presence                                                                             |
| `RunCompleted`          | Lobby Room  | Ranking                 | roomId, run, characterIds[], difficulty                                                                       |
| `MatchResultConfirmed`  | Lobby Room  | Ranking                 | roomId, winners[], losers[], difficulty, decidedBy (`agents` \| `moderator`)                                  |
| `MemberAbandoned`       | Lobby Room  | Ranking                 | roomId, accountId, characterId, mode                                                                          |

## SSE projection (`GET /v1/stream`)

`queue.updated`, `ready_check.started`, `ready_check.resolved`, `room.assigned`, `room.stage_changed`,
`room.run_opened`, `match.result`. Each has an `id` for `Last-Event-ID` resume; keep-alive comment every 25 s.
Documented in `packages/contracts/asyncapi.json` (generated, ADR 020).
