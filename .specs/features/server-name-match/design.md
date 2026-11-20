# Server name match — Design

Spec: `spec.md`. Large because it crosses the contract, two API modules, the shared kernel and the agent. It keeps
every dependency direction of AGENTS.md rule 1.

## Shape

One question, asked twice: _which known character does this read name stand for?_ The answer is a pure function in the
shared kernel. Identity uses it on a card batch, Lobby Room on a chat sighting. Neither module imports the other: Lobby
Room asks for member names through a port that `main/` implements over Identity, as it does for `characterOf` today.

```text
agent (chat step, GNR-07)              API
  ChatEvent{Joined|Left, name}  ──►  POST /v1/lobby-rooms/:id/observations   (existing route, contract text changes)
    core/chat_post.rs                  lobby-room.application.recordObservation
    adapters: post_observation           ├─ domain Observation.of      value rule per type (SNM-01)
                                         ├─ port MemberNames (main/ → Identity.characters)   names stay in this request
                                         ├─ shared-kernel matchCharacterName(read, known[])  (SNM-02)
                                         └─ stores {type, run, value = joinOrder}            read name dropped (SNM-03)
agent (card batch, CHR-09)  ──►  POST /v1/me/characters
                                   identity.application.recordCharacters
                                     └─ shared-kernel matchCharacterName + guards            (SNM-07)
```

## What changes, by layer

| Layer                  | Where                                                                 | Change                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts              | `packages/contracts/src/http/lobby.ts`                                | `Observation.value` documented per type; a `PlayerNameValue` schema (the reading rule of SNM-01) exported for the two player types; schemas regenerated        |
| contracts (generated)  | `openapi.json`, `asyncapi.json`, `json-schema/`, agent `generated.rs` | regenerated (`pnpm contracts:openapi`, `cargo run -p xtask -- contracts`) and committed (rule 2, ADR 020)                                                      |
| shared kernel          | `apps/api/src/shared-kernel/character-name-match.ts` (new)            | `matchCharacterName(read, known) → {kind:'one', index} \| {kind:'none'} \| {kind:'ambiguous'}`; pure, no I/O; the I/l/1 and 0/o folds and the `o`↔`g,e,b` rule |
| lobby-room domain      | `domain/observation.ts`                                               | `Observation.of` refuses a player observation whose value breaks the reading rule; a stored player observation holds a join order                              |
| lobby-room application | `application/lobby-room-use-cases.ts`, `ports.ts`                     | `recordObservation` matches player observations before storing; new port `MemberNames.namesOf(roomMembers)`                                                    |
| main                   | `apps/api/src/main/` (composition)                                    | implements `MemberNames` over the Identity character use case (the class and level port already exists there)                                                  |
| identity application   | `application/record-characters.ts`, `character-ports.ts`              | reconcile cards before the batch is parsed against the account's limit; `storedNames` becomes `storedCharacters` (name, class, mode, level)                    |
| agent adapters         | `adapters/src/http/translate.rs`, `gateway.rs`                        | `player_observation_to_contract`; the post goes through the existing `post_observation`                                                                        |
| agent core             | `core/src/chat_post.rs` (new), `messages.rs`, `ports.rs`              | `PlayerObservation`; consumes `ChatEvent` from the chat step; rate cap; one post per event. **No reading module is edited**                                    |
| acceptance             | `tests/acceptance/steps/server-name-match.steps.ts`                   | steps; reuses the wire (`support/agent-wire.ts`) of agent-trust                                                                                                |

## Contract (rule 2)

No new route. The route's body schema is the same shape: `value` stays `string(max 64)`. What changes is the documented
meaning for `PLAYER_JOINED_SEEN` and `PLAYER_LEFT_SEEN`, an exported `PlayerNameValue` (the CHR-10 rule widened for what a screen
misreads: 2 to 15 characters of `[A-Za-z01]`, first and last a letter, at most one inner `-` or `_`) that the API applies to those two types, and the `202` description
("`stored` is false when the name matched no member"). A server that validates at the domain keeps the `UNKNOWN`
catch-all of the type (AWS-25) intact. `contracts:check` fails on drift.

## The rule (SNM-02)

`matchCharacterName(read, known)` compares `read` with each known name:

1. Same length, else no.
2. Per position, equal after folding case; `I`, `i`, `l`, `1` are one glyph; `0` and `o` are one glyph (the agent's
   `glyph_key`, CHR-10); or the known letter is `o`/`O`/`0` and the read letter is `g`, `e` or `b` (item g).
3. Exactly one known name passes → `one`; none → `none`; more than one → `ambiguous` (treated as none).

Directional on purpose: a known `g` is never matched by a read `o`, so a character named `Gog` is never swallowed by a
read of `Oog`. Tests: each fold, each of `g`, `e`, `b`, uppercase and lowercase, the reverse direction refused, two known
names that both pass (ambiguous), a name one letter longer, and the I/l/1 collisions of the glyph table.

## Characters (SNM-07)

In `recordCharacters`, inside the transaction that already holds the account lock, after reading the stored characters:
for each card whose name is not stored (by `characterKey`), find the stored names it stands for; if exactly one, `N`,
and `N`'s class and mode equal the card's, and the card's level is not below `N`'s, and no card of the batch is named
like `N`, the card is renamed to `N` before the limit check and the upsert. The batch's own rules (CHR-10: unique names
in a batch, 1 to 24 cards) run on the renamed batch. Span: `d2r.characters.count` as today and `d2r.characters.reconciled`
(a count). Nothing else about the read name is recorded.

## Chat sightings (SNM-03)

In `recordObservation`, after the membership check (`403` first, nothing read) and the idempotency check:
for `PLAYER_JOINED_SEEN` / `PLAYER_LEFT_SEEN`, build the candidates from the room's members who have a character
(`MemberNames.namesOf`), match, and on `one` store an `Observation` whose `value` is the member's join order as a decimal
string; on `none` or `ambiguous`, return `stored:false` and write nothing. The read name is a local in the use case's
frame; it is never passed to a repository, an outbox row, an event or `annotateActiveSpan`. The span carries
`d2r.observation.type` and `d2r.observation.match` (`matched`, `none`, `ambiguous`; for the other types the attribute is
absent). The idempotency key of an unmatched sighting is not remembered (nothing is stored), which costs one repeated
match, not a duplicate row.

## Agent post (SNM-05, SNM-06)

`core/src/chat_post.rs` takes the chat step's events (`ChatEvent::{Joined, Left}` with the name, from
`game-name-reading`) and, with an assignment held and the run current, builds a `PlayerObservation { kind, run, key,
name, confidence, captured_at }` for the existing gateway. A token bucket of 20 a minute (a pure, clock-injected struct
with its own unit tests) drops the rest. The name is checked against the reading rule (SNM-01) before it is built. The gateway maps it
to the contract with `player_observation_to_contract`; it adds no key. The agent never retries a chat sighting (the
line is gone from the screen); a failed post is counted with a fixed word.

## Telemetry (rule 10; no name anywhere)

| Where                                 | Name                                | Attributes                                                           |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| API span `lobby.record-observation`   | existing                            | `d2r.observation.type`, `d2r.observation.match` (fixed words)        |
| API span `identity.record-characters` | existing                            | `d2r.characters.count`, `d2r.characters.reconciled` (counts)         |
| API metric                            | `d2r.observation.matches` (counter) | `match` = `matched`, `none`, `ambiguous`; `type`                     |
| Agent span `agent.chat.post`          | new                                 | `kind` = `joined`, `left`; `outcome` = `posted`, `dropped`, `failed` |
| Agent counter `agent.chat.posts`      | new                                 | `kind`, `outcome`                                                    |

No attribute key or value may hold a name, a part of one, a hash of one or its length; the leak test (SNM-04) sends a
distinctive name and scans every span, event, metric label, log line and response, in the key set the telemetry package
strips and in every other key a library can carry it under (lessons: privacy).

## Privacy summary for the security reviewer

- Leaves the PC: a classified chat name, 2 to 15 characters, with the observation's own keys, over TLS, to the API the
  agent already authenticates to; never a frame, a crop or a line. Bounded to 20 a minute.
- The server holds the name for one request, in memory; stores a join order, or nothing.
- A misread card name is discarded when it stood for a stored character.
- Reads of strangers' names leave the PC and are dropped on the server (the cost of matching on the API, spec Decisions).
- Threat: an agent reporting that members joined or left falsely. It changes no state in F2 (SNM-08); F3 pairs both
  sides' observations (INV-10) before anything counts.
- Threat: probing member names (post guesses, read `stored`). Only a member's agent can post; the room has at most a few
  members; the 20 a minute cap is on the agent and the API's per-agent limits (`agents` rate limits) still apply. The
  answer says only whether a name stood for someone in the caller's own room.

## ADRs

Relies on ADR 010 (read-only agent), 011 (agent token), 017 (names), 020 (contracts) and AGT-01 (the token's reach). A
Proposed **ADR 036** (T6) records that a chat name may leave the PC to be matched and dropped; the maintainer accepts it.
