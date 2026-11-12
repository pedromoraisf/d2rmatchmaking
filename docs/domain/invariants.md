# Domain invariants

The domain guarantees these; each one needs at least one unit test and survives mutation testing.
IDs are stable — cite them in specs (`INV-03`).

| ID     | Invariant                                                                                                                                                                           | Owner                    | Source                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------- |
| INV-01 | A `QueueTicket` only matches tickets with the same region, difficulty, ladder and era. The ELO band may widen with waiting time; those filters never do.                            | Matchmaking              | FR-08, FR-10              |
| INV-02 | A character only queues for a difficulty unlocked on it and, in leveling, with level ≥ that difficulty's floor.                                                                     | Matchmaking              | FR-09                     |
| INV-03 | Only accounts with a paired and online agent, a linked Battle.net account and a connected site can queue. No manual confirmation.                                                   | Matchmaking              | FR-31                     |
| INV-04 | An account has at most one active queue ticket or room at a time.                                                                                                                   | Matchmaking + Lobby Room | Design Doc                |
| INV-05 | Ready check lasts 1 minute. Not answering gives a 5-minute wait; declining carries no penalty, for now; members who accepted return to the top of the queue.                        | Matchmaking              | FR-12, FR-13              |
| INV-06 | A `LobbyRoom` reaches `created` only with a valid host observation of the expected game name, and `active` only when every member is confirmed by their agent.                      | Lobby Room               | FR-15, FR-16              |
| INV-07 | A room expires if the host does not create the game within 3 minutes.                                                                                                               | Lobby Room               | FR-17                     |
| INV-08 | Game names follow `mm{activity}{difficulty}-{n}`; the password is always empty.                                                                                                     | Lobby Room               | FR-14, ADR 017            |
| INV-09 | Observations are idempotent: the same key never changes state twice.                                                                                                                | Lobby Room               | Design Doc                |
| INV-10 | A PvP round counts only when both sides' agents report the same reading.                                                                                                            | Lobby Room               | FR-19                     |
| INV-11 | Disputes: (1) pair both agents' observations; (2) if still divergent, the room hierarchy decides — host first, then members by ascending join order.                                | Lobby Room               | FR-20, FR-30              |
| INV-12 | If a member's site or agent drops beyond the configured tolerance, the member leaves in a controlled way; if it is the host, the host role passes to the next member by join order. | Lobby Room               | FR-32                     |
| INV-13 | Leaving an active duel is a loss by W.O. Leaving a leveling session carries no penalty.                                                                                             | Lobby Room + Ranking     | FR-21, PRD open questions |
| INV-14 | ELO changes only with a result confirmed by both sides or decided by a moderator.                                                                                                   | Ranking                  | FR-22                     |
| INV-15 | Ratings are per character × difficulty × season.                                                                                                                                    | Ranking                  | ADR 018                   |

Decided 2026-11-10 by the maintainer: declining a ready check carries no penalty for now (INV-05, "Não. Hoje não deve
acontecer nada"). Open (pending the maintainer, before F3): how step 2 of INV-11 avoids a 1v1 host deciding their own
dispute. Until answered, specs that touch them take the
conservative default and record an assumed decision.
