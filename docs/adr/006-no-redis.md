# ADR 006 — No Redis in the MVP

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Queue, ready check, presence and pub/sub need fast shared state. Upstash's free 500k commands/month do not cover heartbeats, and there is a single instance.

## Decision

Keep them in memory behind ports (`QueueStore`, `ReadyCheckStore`, `PresenceStore`, `EventBus`). Rooms, results and ratings are in Postgres.

## Alternatives considered

Upstash Redis; Postgres LISTEN/NOTIFY.

## Consequences

A restart loses queues; clients re-enter automatically when SSE reconnects. A second instance requires replacing these adapters (new ADR).
