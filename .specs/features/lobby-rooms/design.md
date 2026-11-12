# Lobby rooms — Design

Relies on ADR 002/003/004, 007 (SSE), 008 (outbox), 017 (game names), and on `queues` (host named by the match),
`ready-check` (`MatchFormed` after acceptance) and `agent-game-name` (`GAME_NAME_SEEN` from the Party panel).

## Lobby Room module

| Layer       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | `LobbyRoom` grows to the full state machine: `formed → awaiting_host → created → active`, `→ expired` (from `awaiting_host`, 3 min after `awaitingSince`), `→ closed`; members carry `joinOrder`, `role`, `confirmedRun`; `markAssignmentDelivered`, `observeGameName(accountId, run, name, now)`, `expireIfDue(now)`, `openNextRun(by, nextName, now)`, `leave(accountId)` (host handover by lowest join order), `close(by)`; every transition returns the events to write; pure, `now` passed in |
| application | use cases `onMatchFormed` (exists), `onAssignmentFetched`, `recordObservation` (exists, extended), `expireRooms` (timer), `openNextRun`, `leaveRoom`, `closeRoom`, `dropMember` (FR-32); port `MemberConnectivity` (agent online, site stream open) implemented in `main/`; `hasOpenRoom` (exists from queues)                                                                                                                                                                                     |
| adapters    | Postgres: `lobby.members` gains `confirmed_run` and `left_at`, `lobby.rooms` gains `awaiting_since` and `closed_at` (new migration); routes `POST /v1/lobby-rooms/:id/runs` (host), `POST /v1/lobby-rooms/:id/leave`, `POST /v1/lobby-rooms/:id/close` (host), all session + same origin; `GET /v1/me/room` extended                                                                                                                                                                               |
| main        | the 3-minute expiry and the drop tolerance (`ROOM_DROP_TOLERANCE_SECONDS`, default 60) through `TimerScheduler`; subscribers for `AgentPresenceChanged` and the site-stream closed notification (from `queues`)                                                                                                                                                                                                                                                                                    |

Events: `RoomStageChanged` (exists), `RoomAssignmentChanged` (exists), `RoomRunOpened`, `RoomMemberChanged` (confirmed,
left, host changed); stream projection to `room.stage_changed`, `room.assigned`, `room.run_opened` for sites and
agents. Contracts and AsyncAPI regenerated.

## Site

`features/lobby-room/RoomPanel.tsx` rebuilt on the prototype's room panel inside the shell (`room-h`, stepper, `cred`
with copy, steps list, `pl` member rows with `pres` badges, run log), without password, manual confirmation, W.O. or
score. Copy uses the Clipboard API with a visible fallback.

## Telemetry

Spans `lobby.<use-case>`; metrics `d2r.room.final_stage` (counter by stage) and `d2r.room.time_to_active` (histogram),
added to the AD-087 list with dashboard panels.
