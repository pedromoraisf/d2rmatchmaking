# ADR 039 — Spotted rooms: owner and data model

**Status**: Proposed
**Date**: 2026-11-28
**Deciders**: maintainer
**Supersedes**: none

## Context

FR-33…FR-36 add rooms spotted in game: regular D2R public games that a player's agent reads on the game-search
screen, listed next to the platform's rooms with their origin shown (`docs/product/direction-2026-11.md`, AD-177).
A spotted room has a name, a player count and a time of last sighting. It has no members, host, stages, score or
rating, and the platform controls none of it.

The forces:

- ADR 002 fixes one API with five modules; `docs/domain/contexts.md` has no "live rooms" context, although the PRD
  labels FR-25, FR-26 and FR-33…FR-37 "Salas ao vivo".
- ADR 006: no Redis; live state stays in memory behind ports. One instance.
- The data describes games of players who never used the platform (ADR 040). Storing less is safer.
- The room list is pushed live to every signed-in player. The stream is already 3.3 times over the 125,000 bytes per
  player-hour target (F2 review, AD-128), so the list cannot send one event per sighting.
- The agent talks to the owner of each fact (contexts.md): observations go to Lobby Room.

## Decision

1. **Lobby Room owns spotted rooms.** `SpottedRoom` is its own aggregate in `modules/lobby-room/domain`, separate
   from `LobbyRoom`: it shares no state machine, table or invariant with it. Sightings and join attempts are two new
   observation kinds on the existing observations route. No sixth module; ADR 002 is untouched.
2. **Spotted rooms live in memory only**, behind a `SpottedRoomStore` port, keyed by region and game name
   (normalised). Nothing about a spotted room is written to Postgres or to the outbox. A restart empties the list;
   the next sightings rebuild it.
3. **Lifetime** is a pure domain rule over an injected `Clock`: stale after 5 minutes without a sighting, removed
   after 10; removed at once by a "game does not exist" join attempt; marked full by a "game is full" one. The two
   periods are read from the remote configuration, clamped to a range like every other value there.
4. **A game enters the list only from the game-search screen.** A sighting from inside a game refreshes a listed room
   and never creates one.
5. **The list is one read model with two origins.** The room-list query and its stream carry `origin`
   (`platform` | `spotted`) on every row from F3, when only platform rooms exist. Changes reach the site as a snapshot
   on connect plus coalesced changes (at most one per room per 15 seconds for a spotted room); a row's "seen N ago" is
   computed by the site from `lastSeenAt`.
6. **A sighting is rate-limited per agent** and bounded in size (name length, rows per report), like the chat
   sightings of ADR 036.

## Alternatives considered

- **A sixth context, "Room Directory"**, owning the list read model and the spotted rooms. Cleaner in language (a
  spotted room is nothing like a `LobbyRoom`) and it keeps Lobby Room focused; the orchestrator recommended it. Not
  chosen as the default because it amends ADR 002's five modules and adds a module boundary, ports and events for a
  list that today has one consumer. It stays the natural next step if the list grows its own rules (search, favourites,
  history); moving one aggregate and one store later needs no data migration.
- **The Agents context owns sightings**, as device facts. Rejected: Agents would then own a room listing, and the list
  would be assembled across two modules.
- **Postgres table with a retention job.** Rejected: it stores third-party data the product does not need after ten
  minutes, adds a migration and a sweep, and a write per sighting on the free tier.
- **One SSE event per sighting.** Rejected: it multiplies the stream bytes by the number of agents on the game-search
  screen.

## Consequences

- No migration and no retention question: nothing is kept.
- A restart or a deploy shows an empty "Spotted in game" section for up to a few minutes.
- Lobby Room gains a second aggregate and two observation kinds; its mutation scope grows.
- With a second API instance (not in the MVP, ADR 006) the store would have to move behind a shared port.
- Revisit when the list needs its own rules or a second instance: promote the alternative above.
