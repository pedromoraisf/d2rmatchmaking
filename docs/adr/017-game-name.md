# ADR 017 — Game name pattern

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The host creates the game manually; the agent verifies it by OCR; the community must read it.

## Decision

`mm{activity}{difficulty}-{n}` (e.g. `mmbaalh-12`), always with an empty password (public game in the Game List).

## Alternatives considered

Random names.

## Consequences

Readable and OCR-verifiable. Public games can receive outsiders; the agent flags non-members to the group, and the host can use the Game Creator's player limit and level difference.
