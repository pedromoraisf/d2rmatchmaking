# Server name match — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (design in `design.md`) · **Security review**:
yes (a player name read on screen leaves the PC; the API matches it to people)

## Problem

Two things the agent reads are names of players, and the agent cannot tell whose they are:

- **Character cards (F1 post-close item g, FR-02).** The 43 wrong reads of the selection screen are all the `O` of a
  character name read as `g`, `e` or `b`. The agent already folds `I`, `l`, `1` and `0`, `o` against names it posted
  before (`reconcile_names`, CHR-10), but only inside one run of the agent and only for those glyphs. A misread name
  that the account has not posted yet is stored as a new character: a duplicate on the site, one more of the 60 the
  account may hold.
- **The chat (FR-27, GNR-08).** `game-name-reading` reads the chat's "joined" and "left" messages and keeps them in the
  process (GNR-07, GNR-10). The `Assignment` the agent holds carries character **ids**, not names, so the agent cannot
  tell a member from a stranger. `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN` exist in the glossary and the contract, and
  nothing posts or uses them. GNR-08 moved here: the contract change and the matching of a read name to the room's
  members belong to the API, which knows the names (`identity.characters.name`).

Both are the same question asked of the server: **which of the account's, or the room's, known characters does this read
name stand for?** The answer is one pure rule, in the shared kernel, used by both.

## What this feature changes, and what it does not

| Changes                                                                                                      | Does not change                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| The observation contract: what `value` holds for the two player observations (rule 2, regenerated)           | Any route, any status code, `X-Agent-Version`, the agent token's reach (AGT-01)     |
| One pure name-match rule in the shared kernel, tested on the glyph reads observed                            | The agent's reading of the chat or of the cards (`game-name-reading`, `characters`) |
| `record-characters`: a read name that stands for a stored character updates it instead of adding a duplicate | The stored spelling of a name, the 60-character limit, ladder and era               |
| `record-observation`: a player observation is matched to a room member and only the result is stored         | Room stages, confirmation, scores, disputes (`LBR-*`, F3)                           |
| The agent posts the chat events once the contract exists (GNR-08)                                            | Any reading module (rule 14); `chat_step.rs` is `game-name-reading`'s               |

## What leaves the PC, what the server keeps (NFR-04, ADR 010)

A name read on screen is personal data of whoever typed it: the player, a room member, or a stranger in a public game.

| Item                                                    | Leaves the PC?                                                                                                                              | Server keeps                                                                                                                       | For how long                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A character name read on the selection screen           | Yes, as today: the account's own characters, in the card batch (CHR-09), once per change                                                    | The stored character name (the canonical spelling). **A misread that matched a stored name is discarded, never stored**            | As long as the character exists (the player's own list)        |
| A chat name of a joined or left line                    | **Yes, once per new line**, only while a room assignment is held for the current run, and only a name that meets the reading rule of SNM-01 | **Only the match result**: the matched member's join order, or nothing. **The read name is never stored, logged or put in a span** | As long as the room's observations (see Decisions, open point) |
| A chat line, the words around the name, a frame, a crop | **No**                                                                                                                                      | Nothing                                                                                                                            | —                                                              |
| A name that matches no member                           | Yes (the agent cannot know it is a stranger; see Decisions)                                                                                 | **Nothing**: not the name, not a row, not a count by name                                                                          | Held in memory for the length of one request                   |

What a span, a log line, a metric label or an error body may carry: a count, and the fixed words `matched`, `none` and
`ambiguous` for the result (`d2r.observation.match`), the observation type, the run number. **Never a name, a part of a
name, a hash of a name or the length of a name.** The agent side is the same: counters with the fixed words `joined`
and `left` (GNR-10), nothing else.

## Requirements

- **SNM-01** — The observation contract SHALL state that for `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN` the `value` is
  one character name as read from the chat, and the API SHALL refuse (`400`, `invalid-observation`, nothing stored) a
  value of those types that does not meet the name rule as a screen can misread it (2 to 15 characters, letters and the digits `0` and `1`,
  which the screen reads for `o`, `i` and `l`, at most one inner `-` or `_`; the rule of CHR-10 widened by those two digits). The other types are unchanged. `openapi.json`, `asyncapi.json`, the JSON schemas and the agent's
  `generated.rs` SHALL be regenerated and committed with it (AGENTS.md rule 2).
- **SNM-02** — A read name SHALL stand for a known character when, compared letter by letter with the same length, every
  letter is equal after folding case, `I`/`i`/`l`/`1` to one glyph and `0`/`o` to one glyph (the agent's `glyph_key`,
  CHR-10), **or** the known name has an `o` at that position and the read has `g`, `e` or `b` there (item g, the 43
  wrong reads). The match SHALL be directional (a known `g` is never matched by a read `o`), and a read that stands for
  more than one known name SHALL stand for none. The rule SHALL be one pure function, with a unit test for each glyph read
  on a real print and for the name it must not match.
- **SNM-03** — WHEN a member's agent posts a `PLAYER_JOINED_SEEN` or `PLAYER_LEFT_SEEN` for the room it belongs to, THEN
  the API SHALL match the value against the character names of the room's members (the characters they queued with) by
  SNM-02, and store the observation with `value` replaced by the matched member's join order and the reporting agent,
  run, type and instant as for any observation. A value that matches no member, or more than one, SHALL be answered `202` with `stored` `false`, with no row, no outbox event and no change to the room. The same key posted again SHALL change nothing
  (INV-09).
- **SNM-04** — The read name SHALL exist only in the request's memory: no table, outbox payload, event, log line, span
  attribute or event, metric label, error body or response SHALL hold it, a part of it or a hash of it, on the API
  (SNM-03, SNM-07) and on the agent. The `lobby.record-observation` and `identity.record-characters` spans SHALL carry
  only counts and the fixed words of the table above. A test SHALL send a distinctive name through each path and scan
  every span, log line and response for it.
- **SNM-05** — WHILE the agent holds a room assignment, WHEN the chat step classifies a new line as joined or left with
  a name that meets the reading rule of SNM-01, THEN the agent SHALL post one observation of that type for the held run, with a fresh
  idempotency key, the name as read, the reading's confidence and the capture instant, on the existing observation
  route. It SHALL post nothing without an assignment, for a line it did not classify, for a name that does not meet the
  reading rule, or for a line already posted. At most 20 chat observations a minute SHALL leave the agent; the rest are dropped.
- **SNM-06** — What leaves the PC for SNM-05 SHALL be the observation's own keys and nothing else: `idempotencyKey`,
  `type`, `run`, `value` (the name, 2 to 15 characters), `confidence`, `capturedAt`. No frame, crop, chat line, word
  around the name, or other player's text. The agent's HTTP adapters SHALL keep to the AGT-05 rule (contract bodies only)
  and the post SHALL travel the same route and the same token as any observation (AGT-01).
- **SNM-07** — WHEN an agent posts the characters it read and a card's name is not one the account holds, THEN the API
  SHALL treat the card as the stored character `N` when exactly one stored name `N` stands for the read name by SNM-02
  **and** the card has the same class and the same mode (softcore or hardcore) as `N` **and** a level at or above `N`'s
  **and** the batch holds no card named like `N`. The stored name stays `N`; the misread SHALL be discarded; the count of
  reconciled cards SHALL be a span count (`d2r.characters.reconciled`). Any other card is stored as before, and the
  account limit (CHR-10) counts only the names that are really new.
- **SNM-08** — The matching SHALL never widen what an agent may do: a player observation changes no room stage, confirms
  no member, scores nothing and sends no event in F2; an agent not in the room is refused as for any observation (`403`);
  and an agent can report only what its own screen showed (a member's agent posting that another member joined is data
  about that agent's screen, not a fact the server believes). Scores and disputes that pair both sides' observations are
  F3 (INV-10, INV-11).

## Sources

| ID     | Source                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| SNM-01 | FR-27; glossary (`PLAYER_JOINED_SEEN`, `PLAYER_LEFT_SEEN`); AGENTS.md rule 2 (contracts first); ADR 020; GNR-08            |
| SNM-02 | FR-02; F1 post-close item g (43 wrong reads, `O` as g/e/b); CHR-10 (`glyph_key`); lessons ("Agent reading", every glyph)   |
| SNM-03 | FR-16, FR-27; INV-09 (idempotent observations); design-doc § Lobby Room; brief row `server-name-match`; GNR-08             |
| SNM-04 | NFR-04; AGENTS.md rule 10; `docs/engineering/telemetry.md`; GNR-10; CHR-13 (names never reach the span); lessons (privacy) |
| SNM-05 | FR-27 (joined and left messages); brief exit criterion "Chat"; GNR-07, GNR-08; AGN-05 (one post per run)                   |
| SNM-06 | NFR-04 ("only structured observations"); ADR 010; AGT-05, AGT-01                                                           |
| SNM-07 | FR-02 (fusion); F1 post-close item g; CHR-09, CHR-10; security finding 2 (account limit)                                   |
| SNM-08 | ADR 010 (the server sends data only; the agent reports); INV-10, INV-11; LBR-* (rooms); AGT-01                             |

## Requirement Traceability

| Requirement ID | Story              | Proof                                                                                                                                     |
| -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SNM-01         | Name rule          | Contract tests + `contracts:check` + API integration + acceptance `@SNM-01`                                                               |
| SNM-02         | Whose name is this | Vitest on the pure rule (every glyph, both directions, ties, and the I/l/1 and 0/o folds written out as the agent's `glyph_key` has them) |
| SNM-03         | Member matched     | API integration (Postgres) + unit tests of the use case with fakes; acceptance `@SNM-03`                                                  |
| SNM-04         | No name kept       | API test with the in-memory exporter and the log sink + agent unit tests + source rule; acceptance `@SNM-04`                              |
| SNM-05         | Agent posts        | Rust unit tests with the fake gateway + acceptance `@SNM-05` (headless agent, drawn chat fixture)                                         |
| SNM-06         | What leaves the PC | Rust unit tests on the body keys + source rule (AGT-05) + acceptance `@SNM-06` (recording proxy)                                          |
| SNM-07         | Misread card       | Vitest on the use case + API integration + acceptance `@SNM-07`                                                                           |
| SNM-08         | No new authority   | API integration (stage unchanged, no outbox row, 403 for a non-member) + acceptance `@SNM-08`                                             |

## Stories

- As a player, I want my character list to show each character once, even when the screen misread a letter of its name
  (SNM-02, SNM-07).
- As a player, I want the room to know who joined and left the game from the chat, without my agent or the server keeping
  anyone's name (SNM-03, SNM-04, SNM-05).
- As another player in a public game, I want my name to leave your PC only to be matched and thrown away when I am not in
  your room (SNM-03, SNM-04, SNM-06).
- As the maintainer, I want one rule for "is this the same name", tested glyph by glyph, and the privacy of the names
  written down and tested (SNM-02, SNM-04).

## Decisions (conservative defaults)

- **The API matches, not the agent.** Matching on the PC would mean sending every member's character name to every
  member's agent, which is more personal data moving to more PCs. Matching on the API moves one read name to the server
  and throws it away. The cost is that a stranger's chat name also leaves the PC, since the agent cannot know. It is
  bounded: only a classified line, only a name that meets the reading rule of SNM-01, only with a room held, at most 20 a minute, over
  TLS, to the API that already receives the room's observations. _To confirm in the phase review._
- **Only the match result is stored.** `value` of a stored player observation is the member's join order. An unmatched or
  ambiguous name is not stored at all, not even as a count by name (item: "the server keeps only the match result, not
  the raw read name", orchestrator, 2026-11-20).
- **The `O` rule is directional and the character reconcile has three guards** (class, mode, level not lower, one
  candidate). A wrong reconcile overwrites a real character's level; a missed one adds a duplicate the player can see.
  The duplicate is the cheaper failure, so every doubt stores the card as new (as today). _To confirm in the phase
  review: whether to also offer the player a "merge" on the site (not in this feature)._
- **A player observation changes no room state in F2** (SNM-08). What the server does with who joined and left (member
  presence, drops, scores) is `lobby-rooms` / F3.
- **No new route, no new status code.** The route stays `POST /v1/lobby-rooms/:id/observations`; only `value`'s meaning
  and refusal for two types change, and `openapi.json` says so. The whole API integration suite runs in every task that
  touches the route or its use case (lessons).
- **Retention.** No pruning of observations exists today and NFR-05's 30 days is for prints. The stored result holds a join
  order, not personal data, so it is kept with the room's observations. _Open: whether the maintainer wants a retention for
  observations at all (F4, LGPD)._
- **`game-name-reading` is not required for the API half.** The contract, the rule, the characters reconcile and the API
  matching (batch 1) are independent. The agent posting (batch 2) starts after `game-name-reading` is merged into
  `phase/F2`, because it consumes the chat events of GNR-07 (`ChatEvent::Joined` and `Left` of `domain/src/chat.rs`).
- **No reading module is edited** (rule 14). The post lives in a new core module and the existing gateway; if
  `game-name-reading` puts `chat.rs` or `chat_step.rs` on `reading-modules.json`, this feature only calls them.
- **Telemetry.** New spans and attributes use fixed words and counts only (rule 10); see the table in `design.md`.
- **A Proposed ADR (036) records the decision that a chat name may leave the PC to be matched and discarded**, because it
  stretches the wording of NFR-04 ("only structured observations"). The maintainer accepts it (rule 8); until then the
  agent post stays behind the task that needs it (T9).
