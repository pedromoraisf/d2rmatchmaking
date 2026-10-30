# ADR 018 — ELO per character and difficulty

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

PvP balance differs by character build and difficulty.

## Decision

Rating per character × difficulty × season, classic ELO with K = 32, only from double-confirmed results.

## Alternatives considered

One rating per account; Glicko-2.

## Consequences

Simple to explain; the rating function sits behind a port, so Glicko-2 can replace it later.
