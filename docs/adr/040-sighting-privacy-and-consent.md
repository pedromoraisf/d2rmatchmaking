# ADR 040 — Privacy and consent of sightings

**Status**: Proposed
**Date**: 2026-11-28
**Deciders**: maintainer
**Supersedes**: none

## Context

Until now the agent read only what concerned its own player's room: the game name the platform generated, the
character-select screen, chat lines matched to room members (ADR 036). With FR-33 and FR-34 it reads the D2R
game-search screen and reports games created by people who may never have heard of the platform. Their game names
are free text they wrote for the game's own lobby, not for a website.

The rules in force:

- ADR 010 and AGENTS.md rule 5: the agent only reads pixels of the game window and OS signals, and sends no input.
- NFR-04: the agent captures only the game window, processes on the PC and sends only structured observations.
- NFR-05: explicit consent for screen capture at install.
- ADR 036: a chat name may leave the PC only to be matched and dropped.
- ADR 037: production telemetry carries no person's identity.

The maintainer's open decisions 1, 2, 3 and 5 of `docs/product/direction-2026-11.md` were closed with the
conservative options (AD-183).

## Decision

1. **Reading stays inside ADR 010.** The game-search screen is one more screen of the game window. The agent never
   clicks, scrolls, searches or joins for the player; it reads what the player's own navigation shows.
2. **A sighting carries only**: the game name as read, the player count, the difficulty when the screen shows it, and
   the reporter's region, ladder and core (from their active character). A join attempt carries the game name and one
   of four outcomes. Nothing else from the screen leaves the PC: no character name, no BattleTag, no list of players
   inside a game, no print.
3. **The reporter is not shown.** The site shows how many agents saw a room, never who. The API keeps the reporting
   account only in memory, for the rate limit, and drops it with the room.
4. **Sending sightings is the player's explicit choice.** It is off until the player answers a question in the capture
   terms (install, or the first start after the update that adds it), with no pre-ticked option. A switch on the
   profile and in the agent window changes it at any time; off stops sending at once. Reading the game-search screen
   for the player's own join attempt on a room they copied from the site needs the same choice.
5. **A game name is third-party free text.** The API passes it through a blocked-terms list before listing it; a
   blocked name is not listed. The room list is for signed-in players only and is not indexable.
6. **Nothing is stored.** Spotted rooms live in memory and expire (ADR 039). Telemetry of sightings carries counts
   and outcomes, never the game name (ADR 037).
7. **Password-protected games are not listed**, by construction: only a game seen on the game-search screen is
   listed. The assumption that the screen shows only games without a password is checked on the real prints before
   F4 starts; if it fails, the feature spec adds the rule that tells them apart or the question returns to the
   maintainer.

## Alternatives considered

- **On by default with a notice.** More agents report and the list fills faster. Rejected as the default: the
  purpose is new and concerns other people's games; an explicit choice is the reading of NFR-05 that needs no later
  apology. The maintainer can switch the default by amending this ADR.
- **Show the host or the players inside.** Rejected: those people did not agree, and the screen does not prove who
  hosts.
- **List games seen only from inside.** Rejected: from inside, the agent cannot tell whether the game has a password.
- **No blocked-terms list.** Rejected: the site would repeat whatever anyone types as a game name.

## Consequences

- The capture terms and the site's "what the agent never does" page gain a section; both are user-facing strings in
  English and pt-BR.
- With opt-in, the "Spotted in game" section depends on players choosing to help; the site says so where the switch
  is.
- The blocked-terms list is a committed file reviewed like the remote configuration; it needs upkeep.
- The legal review of NFR-05 stays in F6; this ADR is its input for sightings.
