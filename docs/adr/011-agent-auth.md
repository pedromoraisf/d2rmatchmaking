# ADR 011 — Agent authentication by pairing code

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The agent must authenticate without ever touching Blizzard credentials.

## Decision

The agent shows a 6-digit code; the logged-in user types it on the site. The API issues a revocable token scoped to heartbeat, observations and push. Agents below the minimum version get `426 Upgrade Required`.

## Alternatives considered

Battle.net login inside the agent.

## Consequences

Pairing codes are short-lived, single-use and rate-limited; tokens are hashed at rest.
