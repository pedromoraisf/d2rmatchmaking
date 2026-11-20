# ADR 036 — A chat name may leave the PC to be matched on the API, and is dropped there

**Status**: Accepted
**Date**: 2026-11-20 (accepted 2026-11-20: asked where to match chat names, the maintainer chose "Casar na API (Recomendado)")
**Deciders**: maintainer

## Context

FR-27 has the agent read the "joined" and "left" messages of the game chat, and the glossary carries the observations
`PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN` for them. `game-name-reading` reads and classifies those lines on the PC
(GNR-07) and keeps the result in the process. To be useful the name in the line has to be tied to a member of the room.

The agent cannot do that today. Its assignment carries character **ids**, not names. The names live on the API
(`identity.characters.name`), and the same question is asked of the account's own characters when the selection screen
is misread (F1 post-close item g: the `O` of a name read as `g`, `e` or `b`).

NFR-04 says the agent "sends only structured observations". A chat name is a name of a person, typed by a player who
may be a member of the room or a stranger in a public game. Sending it stretches the wording of NFR-04, and ADR 010
limits what the agent may read and do, not what it may send, so this needs a decision and not a silent choice.

## Decision

The agent MAY send one chat name as the `value` of a `PLAYER_JOINED_SEEN` or `PLAYER_LEFT_SEEN` observation, on the
existing observation route and token, so that **the API matches it to the room's members and drops it**.

Bounds, all of them required:

- **Only a classified line.** The agent sends a name only for a line it classified as joined or left by the words of the
  language pack, never a chat line, the words around the name, a frame or a crop.
- **Only a name that meets the reading rule**: 2 to 15 characters of letters and the digits `0` and `1`, at most one
  inner `-` or `_` (the D2R name rule widened by what the screen misreads). Anything else is not sent.
- **Only with a room held**, for the held run, and never without an assignment.
- **At most 20 a minute** leave the agent; the rest are dropped on the PC.
- **Over TLS, to the API the agent already uses**, with the agent token, whose reach does not widen (AGT-01).
- **The API keeps only the match result.** For a name that matches one member of the sender's own room, the stored
  observation holds the member's join order. A name that matches nobody, or more than one member, is not stored at all:
  no row, no count by name, no event. The read name exists in the memory of one request.
- **A name is never in a span, a log line, a metric label, an event or an error body**, nor a part of it, a hash of it
  or its length; on the API and on the agent. Counters and spans carry fixed words (`matched`, `none`, `ambiguous`,
  `joined`, `left`).
- **The observation changes no room state** in F2. What the server does with who joined and left is later work, and
  scores still need both sides' observations to agree (INV-10).

The same matching rule (one pure function: case, `I`/`l`/`1`, `0`/`o`, and a known `o` read as `g`, `e` or `b`,
directional, ambiguity means no match) also reconciles a misread character card to the account's stored character
(item g), where the misread spelling is discarded.

## Alternatives considered

- **Match on the agent.** The assignment would carry every member's character name, so the agent could ignore chat
  names that are not members' and send nothing about them. The cost is that every member's PC would then receive the
  other members' character names, before they are in the same game, which moves more personal data to more PCs than
  one read name moving to one server. It also keeps the matching rule and its glyph table on the PC (Rust) and the
  character reconcile on the server (TypeScript), two copies of one rule, and it cannot fix the stored duplicates of
  item g. What it buys: a stranger's name would never leave the PC. Rejected for the first two reasons, with the
  stranger's name as the price (below).
- **Send a hash of the read name.** Names are low-entropy: a hash of a name is the name to anyone who can try a list,
  so it keeps the cost and hides the problem. Rejected.
- **Do not read the chat names.** The chat half of FR-27 and the "Chat" exit criterion of F2 go unmet, and the room
  cannot learn who is in the game. Rejected unless the maintainer prefers to drop the requirement.

## Consequences

- **A stranger's name leaves the PC.** The agent cannot know whether a name belongs to a member, so a name of a player
  who is not in the room also goes to the API, over TLS, and is dropped there. The bounds above limit it to a
  classified line, a held room and 20 a minute. This is the price of matching on the API and the reason this ADR exists.
- NFR-04's text should read "structured observations, which may carry one chat name that the API matches and drops".
  The PRD is the maintainer's; this ADR does not edit it.
- Security review reads the leak tests (no name in any span, log, row or response), the agent's source rules (no frame
  type, no raw body, contract keys only) and the rate bound.
- A retention for the stored join orders is not set: they hold no personal data. LGPD retention (NFR-05, F4) may revisit
  it.
- Supersedes nothing. Builds on ADR 010 (read-only agent), 011 (agent token), 017 (names) and 020 (contracts first).

## Amendment, 2026-11-20 (security review of #101)

The API's `202` for a chat sighting no longer says whether a name matched: it is the same for a match, a miss, an
ambiguous name and a replay (`stored` is always `true` for a sighting). Before, `stored` told a peer's agent whether a
guess stood for exactly one member, which let it search the members' character names. The API also limits the
observation route to 20 a minute for each agent and 40 a minute for each room (`429`, `rate-limited`), so the agent's own
bound of 20 is not the only one. The decision above is unchanged.
