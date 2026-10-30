# Bounded contexts

Source: Design Doc § Modelo de domínio. Three core contexts, two supporting. The agent talks directly to the owner of
each piece of information: ready-check answers go to Matchmaking, observations to Lobby Room, device facts to Agents.

| Context     | Type       | Aggregates                                   | Owns                                                                                                                                                    | Postgres schema |
| ----------- | ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Identity    | Supporting | `Account`, `Character`                       | Battle.net-linked account, session, characters read by the agent from the character-select screen (class, level, ladder/HC, era, unlocked difficulties) | `identity`      |
| Agents      | Supporting | `Agent`                                      | Pairing, token, presence (online, game open, current screen), minimum version, remote config, delivering the assignment                                 | `agents`        |
| Matchmaking | Core       | `QueueTicket`, `ReadyCheck`                  | Queues by mode, region, difficulty, ladder, era; ELO and level bands; group composition; ready check; penalties                                         | `matchmaking`   |
| Lobby Room  | Core       | `LobbyRoom` (`Member`, `Run`, `ScoreReport`) | Room, host, game name, stages, observations, runs, score, disputes, moderation hierarchy                                                                | `lobby`         |
| Ranking     | Core       | `Rating`, `Season`                           | ELO per character × difficulty × season, run counts, rune ranks, boards                                                                                 | `ranking`       |

Cross-cutting: `platform.outbox` (events), telemetry, i18n.

## Context map

```text
Identity ──(account, characters: port)──▶ Matchmaking ──MatchFormed──▶ Lobby Room ──RunCompleted / MatchResultConfirmed / MemberAbandoned──▶ Ranking
   ▲                                          ▲    │ReadyCheckFailed (self)         │RoomAssignmentChanged
   │                                          │                                    ▼
   └────────────── Agents ──AgentPresenceChanged────────────────────────────────▶ Agents (delivers assignment to the device)
```

Ingress in the MVP stays in memory (ADR 006): queue tickets, ready checks in progress and agent presence live behind
`QueueStore`, `ReadyCheckStore`, `PresenceStore`. Rooms, results and ratings are durable.
