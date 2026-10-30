# ADR 008 — Transactional outbox

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Domain events must not be lost when the single instance restarts between commit and publish.

## Decision

Events are written to an outbox table in the same transaction as the state change and relayed by an in-process worker to the EventBus and SSE.

## Alternatives considered

Publish directly after commit.

## Consequences

At-least-once delivery; consumers are idempotent by event id.
