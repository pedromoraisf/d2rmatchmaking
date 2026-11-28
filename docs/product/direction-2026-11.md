# Product and design direction before F3 (November 2026)

Set by the maintainer on 2026-11-28, in a design session held after F2 closed. The interface built through F2 only
validated the idea: an agent reads the game by OCR, the server reacts, the site gives players value. This document
records the product the maintainer now wants to launch, so that the phases can be replanned around it.

It is input for the replanning and for the next kickoff. It approves nothing by itself: a phase brief still needs the
maintainer's approval, and the open decisions below are his.

## Where the design lives

| What               | Where                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design canvas      | <https://claude.ai/artifact/NSA2uCwtGDwJGDP8tgU7DG> (private to the maintainer). Nine artboards, most of them clickable in Play mode                 |
| Canvas source      | `docs/design/` (artboards, index and the list of assets; see its README)                                                                             |
| Logo, version 0    | `docs/brand/logo/svg` (eight vector masters). A vector redraw of the mascot from the maintainer's reel. PNG exports stay on the maintainer's machine |
| Hero video drafts  | On the maintainer's machine, outside the repository (see "Hero video")                                                                               |
| Requirements added | `docs/product/prd.md` FR-33…FR-36 and J6; AD-177 in `.specs/STATE.md`                                                                                |

## The product in one paragraph

Only what is essential and useful on the screen. The centre of the product is a **list of open rooms with filters**,
which the game itself does not have. Matchmaking stays, as one button on that list. The list is what the product
launches with, because at the start there are few players and a queue would be empty.

## Visual identity

- **References**: the layout follows the official Diablo II: Resurrected site section by section (hero with the call
  on the left, text beside a framed panel, a carousel of features, a round selector, a closing call). A pinch of FACEIT
  and Gamers Club gives it the competitive layer: condensed type for numbers and tags, chamfered buttons, live
  indicators, a leaderboard. The audience is mostly English-speaking; the interface is English first (NFR-12).
- **Mascot**: a grinning red imp drawn as a reflective, holographic sticker. Variations: wink, rage (PvP), gold foil,
  no border, one colour, app icon.
- **Type**: Cinzel (display, always capitals), Alegreya Sans (body), Saira Condensed (numbers, tags, status). All open
  licences. The game's own display font is proprietary and is not used.
- **Colour**: ground `#070504`, panel `#110D0A`, bronze frames `#6B5230`, gold `#E3B866` (primary), bone `#EFE6D2`
  (text), blood `#C8281E` (accept, PvP), ember `#FF6A2B` (live, forming), verified green `#7BD88F` (confirmed by the
  agent).
- **Not decided**: turning this into tokens and components in `apps/web`, and adopting the logo in the site and the
  agent. Both wait for the maintainer to approve the identity.

## Screens in the canvas

| Artboard                  | What it shows                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 01 Brand board            | Mascot, variations, palette, type                                                                                       |
| 02 Home                   | Landing page: hero with a background scene, why, features, activities, ranking preview, the read-only agent, final call |
| 03 Open rooms + filters   | The main screen. Two sections: D2RMM rooms and rooms spotted in game. Filters, quick match, empty state                 |
| 03b Room                  | The room after Join or after accepting a quick match: game name, steps, party, stage                                    |
| 04 Ready check            | Only for quick match, shown over the blurred room list                                                                  |
| 05 In game                | A run in progress: game name, party presence, next run, run history                                                     |
| 06 Ranking                | Tabs per difficulty, class filter, podium, the player's position                                                        |
| 07 Profile and characters | Characters read by the agent; the player declares ladder and era here; agent status; preferences                        |

## Decisions taken in the session

Each one changes or reorders something the PRD already has. The replanning maps them to requirements and phases.

1. **The room list is the launch feature.** FR-25 and FR-26 sit in F3 today and FR-26 is a Should. In the new vision
   they come first.
2. **Join enters the room directly**, with no ready check (FR-26).
3. **Quick match replaces the matchmaking page.** One button on the room list queues the player with the filters on
   the screen (activity, difficulty) plus what the character brings (ladder, core, class, level). The player keeps
   browsing while it searches. FR-06, FR-07 and FR-12 keep their rules; their interface changes.
4. **The ready check exists only for quick match.**
5. **Character details move to the profile.** Ladder and era (FR-02) are declared on the profile screen, not on the
   first screen.
6. **Rooms spotted in game** join the list (FR-33…FR-36, next section).

Assumed while drawing, to confirm: the host starts the next run with one button and the next game name is already
shown (FR-18); a new character appears on the profile the first time the agent sees it in game.

## Rooms spotted in game (FR-33…FR-36)

A player who has the agent opens the D2R game-search screen, or enters a regular public game. The agent reads what
the screen shows and reports it. The server lists that game next to the platform's rooms, always marked with where it
came from. The reverse direction of what the agent does today.

|            | D2RMM room                        | Spotted in game                                           |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| What it is | Created on the platform           | A regular game, seen by the agent of a player             |
| Look       | Gold, solid border, mascot        | Bone, dashed border, eye icon, "SPOTTED" tag              |
| Game name  | Generated (`mmbaalh-34`, ADR 017) | The game's real name, as read                             |
| Activity   | Declared                          | A guess from the name, or unknown                         |
| Party      | Confirmed by each member's agent  | A count, as last seen                                     |
| Status     | Stage of the room                 | Time since the last sighting; "may have ended" when stale |
| Action     | Join (enters the platform room)   | Copy name (the player joins from the game)                |

Rules the maintainer stated:

- The listing depends on **new OCR on the D2R game-search screen** (FR-33). The agent has never read that screen.
- **A spotted room disappears when it proves unavailable**: if a player copies its name, tries to join in the game and
  the game answers that the game is not available, the agent reads that answer and the server removes the listing
  for everyone (FR-36).

What this means for the agent:

- It stays inside rule 5 of `AGENTS.md`: reading pixels of the game window. It sends nothing into the game.
- The new reading logic falls under rule 14 (OCR reading logic): it needs real prints of the game-search screen,
  the game list, a selected game and the "unavailable" answers, in English and Portuguese clients (NFR-12). Only the
  maintainer can capture them, and they stay outside the repository.
- NFR-04 holds: only structured observations leave the PC.

## Open decisions (the maintainer's)

1. Do games with a password get listed? From inside a game the agent cannot tell whether it has one.
2. Which data of a spotted room is shown? Players in that game who do not use the platform never agreed to be listed.
   The design shows the game name and a player count only, and "host unknown".
3. Can a player switch off the reporting of sightings from their own agent?
4. After how long without a new sighting does a spotted room leave the list?
5. Is one "unavailable" report enough to remove a room, when "full" and "does not exist" may read alike?
6. Which bounded context owns spotted rooms: Lobby Room, or a separate read model for the live list?
7. Hero video with Diablo II characters. The maintainer released it on 2026-11-28, but the PRD ("sem logos ou imagens
   da Blizzard") and `AGENTS.md` ("Never do") forbid it. One of the two has to change, through an ADR.
8. The 1v1 dispute conflict of interest, still open from before (`docs/domain/invariants.md`).

## Hero video

The home hero wants a short muted loop of a Sorceress fighting a Druid. A draft exists that composes the two official
class images in one scene with a blizzard and a summoning animated in code; the characters do not move. A version in
which they move needs an AI video generator; the start frame and the prompts are ready. Nothing of this is in the
repository, by rule.

## Not designed yet

- The form to create a room (activity, difficulty, note).
- A detail view for a spotted room.
- The switch for sighting reports on the profile.
- Phone layouts beyond wrapping.
- The desktop agent's own window in the new identity.
