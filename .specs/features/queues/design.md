# Queues — Design

Relies on ADR 002/003/004 (modules, layers), 006 (no Redis: in-memory store), 007 (SSE), 008 (outbox), 018 (rating).

## Matchmaking module

| Layer       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | `queue-ticket/queue-ticket.ts` (ticket value: id, accountId, characterId, mode, region, difficulty, ladder, era, rating, level, pvp {format, rules} or leveling {activity, role, minLevel}, joinedAt); `entry-rules.ts` (QUE-03, QUE-04: declared ladder and era, floors, Heralds; pure; the combined ladder `sc-ladder` … is derived from hardcore + ladder); `band.ts` (QUE-08: `bandAt(rating, joinedAt, now)`); `matcher.ts` (QUE-07 … QUE-12: `formGroups(tickets, now) → { groups, remaining }`, pure, deterministic order by joinedAt then id; host, join order, 2v2 snake teams) |
| application | ports `QueueStore` (in memory), `CharactersPort` (Identity: character of an account), `AgentsPort` (current agent online), `AccountLinkPort` (Identity: Battle.net linked or test account allowed), `SiteConnections` (open site stream), `RoomsPort` (Lobby Room: open room of an account), `RatingsPort` (1500 until F3), `Clock`; use cases `joinQueue`, `leaveQueue`, `runMatcher` (removes grouped tickets, appends `MatchFormed` to the outbox in one unit of work), `dropTicket` (QUE-14); `queue.updated` events to the site                                                     |
| adapters    | `memory/memory-queue-store.ts`; `http/routes.ts`: `POST /v1/queue/tickets`, `DELETE /v1/queue/tickets/:id`, `GET /v1/queue/tickets/me`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| main        | wires the ports to Identity, Agents, Lobby Room and the stream hub; a 1 s matcher timer through the existing `TimerScheduler`; subscribers for `AgentPresenceChanged` (offline), `AgentRevoked`, site stream closed > 30 s                                                                                                                                                                                                                                                                                                                                                               |

Identity and Lobby Room gain the small public port methods the adapters call (`characterOf(accountId, characterId)`,
`isLinked(accountId)`, `hasOpenRoom(accountId)`), each in their `index.ts`. The stream hub exposes `hasSiteStream` and a
"site stream closed" notification to `main/` only.

## Contracts

`JoinQueueRequest` (discriminated by `mode`), `QueueTicketView` (id, mode, options, joinedAt, band or null, poolSize,
status), `QueueRefusal` error codes (`not-your-character`, `undeclared-character`, `difficulty-locked`, `below-floor`, `below-minimum-level`,
`minimum-below-floor`, `activity-not-available`, `agent-offline`, `not-linked`, `site-not-open`, `already-queued`,
`in-room`), site stream event `queue.updated` (ticket view or `{ status: 'left', reason }`). Regions `americas | europe |
asia`; activities `baal | chaos | cows | tz | heralds`; roles `teleporter | bo | killer | leech`; formats
`duel | 2v2 | arena`; rules `gm | bm`. OpenAPI and AsyncAPI regenerated. Room names use the activity code already in
`MatchFormed` (`mm{activity}{difficulty}-{n}`, ADR 017); PvP uses activity `pvp`.

## Site

`features/matchmaking/`: `QueuePanel` (mode cards, character picker from `GET /v1/me/characters`, difficulty buttons
with lock reasons, region, PvP format and rules or leveling activity, role and minimum-level slider, "Find match" with
the first failing entry rule as its reason) and `SearchingPanel` (clock, band, pool size, "Leave queue"), following the
prototype's "Partida" panel inside the `site-shell` frame (or the bare layout if `site-shell` has not merged).

## Telemetry

Spans `matchmaking.join`, `matchmaking.leave`, `matchmaking.match`; metrics `d2r.queue.size` (gauge), `d2r.queue.wait`
(histogram at match). Attributes `d2r.queue.mode`, `d2r.difficulty`, `d2r.ladder`, `d2r.era`. No names.
