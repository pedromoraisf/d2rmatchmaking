# ADR 002 — Modular monolith

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The MVP runs on one Render free instance. Five bounded contexts (Identity, Agents, Matchmaking, Lobby Room, Ranking) have different rates of change and should be extractable later.

## Decision

One deployable API with five modules. Each module owns its Postgres schema and talks to others only through its public port (`index.ts`) or domain events via the outbox.

## Alternatives considered

Microservices; a monolith without boundaries.

## Consequences

One process to operate on the free tier; boundaries are enforced by dependency-cruiser, so a later extraction does not need surgery. Cross-module queries go through ports, never joins across schemas.
