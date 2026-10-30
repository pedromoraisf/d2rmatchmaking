# Ubiquitous language

Use these names in code (types, functions, events, tables), tests and UI keys. UI text is English, translated to pt-BR.

| Term (code) | Meaning |
| --- | --- |
| `Difficulty` | `normal` \| `nightmare` \| `hell`. Fixed matchmaking filter, never relaxed |
| `Ladder` | Combination of softcore/hardcore and ladder/non-ladder (`sc-ladder`, `sc-nonladder`, `hc-ladder`, `hc-nonladder`) |
| `Era` | `lod` \| `rotw` \| `classic` — defines economy and available content |
| `Region` | Game region: `americas` \| `europe` \| `asia`. Fixed filter |
| `Mode` | `pvp` \| `leveling` |
| `Activity` | Leveling: `baal`, `chaos`, `cows`, `tz`, `heralds`. PvP: `duel1v1`, `duel2v2`, `arena6` |
| `PvpRules` | `gm` \| `bm` |
| `QueueTicket` | An account's entry in a queue, with character and preferences |
| `ReadyCheck` | 1-minute window for every matched member to accept; on failure, those who accepted return to the top of the queue |
| `LobbyRoom` | The platform room that corresponds to one game (or one leveling session of runs) in D2R |
| `Host` | Member who creates the game in-game; in leveling, the teleporter |
| `Run` | One game inside a leveling session; each has its own name; none has a password |
| `GameName` | `mm{activity}{difficulty}-{n}`, e.g. `mmbaalh-12` (ADR 017) |
| `Observation` | Fact read by the agent: `GAME_NAME_SEEN`, `PLAYER_JOINED_SEEN`, `PLAYER_LEFT_SEEN`, `SCREEN_CHANGED`, `ROUND_REPORTED`, `PLAYER_SLAIN_SEEN` |
| `Presence` | Device state: online, game open, current screen |
| `Assignment` | What the agent must look for now: room, run, expected name, members |
| `PcState` | Agent's adaptive state machine driving sensor intervals (e.g. `IDLE`, `IN_QUEUE`, `IN_ROOM_JOINING`, `IN_GAME`) |
| `RoomStage` | `formed` → `awaiting_host` → `created` → `active` → `closed` \| `expired` |
| `JoinOrder` | Order in which members joined; drives host succession and the moderation hierarchy |
| `ScoreReport` | One side's report of a PvP round |
| `Dispute` | Divergent score after pairing both agents' observations; resolved by the room hierarchy with prints as evidence |
| `Rating` | ELO for character × difficulty × season (K = 32) |
| `RuneRank` | Named ELO band (Tal … Zod) |
| `Season` | Platform ranking season |
| `WalkOver` (W.O.) | Leaving an active duel counts as a loss (PvP only) |
