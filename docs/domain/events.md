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

## Proposed with the room list (F3, F4)

Names and payloads are settled by the feature specs (contracts first, rule 2). The list must stay inside the stream
budget (NFR-14, AD-128), so it is a snapshot plus coarse changes, never one event per presence change.

| Event                | Publisher  | Consumers | Payload (minimum)                                                                  | Phase |
| -------------------- | ---------- | --------- | ---------------------------------------------------------------------------------- | ----- |
| `RoomListed`         | Lobby Room | SSE       | roomId, origin, activity, difficulty, region, ladder, core, tags[], members, slots | F3    |
| `RoomListingChanged` | Lobby Room | SSE       | roomId, members, slots, stage                                                      | F3    |
| `RoomUnlisted`       | Lobby Room | SSE       | roomId, reason (`full` \| `closed` \| `expired` \| `not-found` \| `stale`)         | F3    |
| `SpottedRoomSeen`    | Lobby Room | SSE       | name, origin `spotted`, region, ladder, core, difficulty?, players, lastSeenAt     | F4    |

`SpottedRoomSeen` is transient, like `AgentPresenceChanged` (AD-056): spotted rooms are not in Postgres (ADR 039).
