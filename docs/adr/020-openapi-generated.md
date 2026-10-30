# ADR 020 — OpenAPI generated from contracts

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

API docs must never drift, and agents forget to update hand-written specs.

## Decision

OpenAPI 3.1 generated from Zod and Fastify (`@fastify/swagger` with the Zod type provider), committed at `packages/contracts/openapi.json`, served at `/docs` outside production; SSE events in AsyncAPI next to it. `pnpm contracts:openapi` regenerates; CI fails on drift.

## Alternatives considered

Design-first, hand-written OpenAPI.

## Consequences

Every route/schema change ships with its docs; the feedback and stop hooks remind and check.
