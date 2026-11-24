# ADR 017 — Game name pattern

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The host creates the game manually; the agent verifies it by OCR; the community must read it.

## Decision

`mm{activity}{difficulty}-{n}` (e.g. `mmbaalh-12`), always with an empty password (public game in the Game List).

The difficulty code is one letter: `n` normal, `m` nightmare, `h` hell (the same codes as the agent's `game_name_match.rs`). The activity is a lowercase word (`pvp`, `baal`, …) and `{n}` is a sequence number. A difficulty outside these three has no name, and the match is refused and logged, not renamed. This paragraph records the codes the code already uses (clarified 2026-11-20 from the #77 review); it changes no decision.

## Alternatives considered

Random names.

## Consequences

Readable and OCR-verifiable. Public games can receive outsiders; the agent flags non-members to the group, and the host can use the Game Creator's player limit and level difference.
