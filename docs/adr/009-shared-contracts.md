# ADR 009 — Shared contracts from Zod

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

TypeScript (web, API) and Rust (agent) must agree on payloads.

## Decision

Zod 4 schemas in `packages/contracts` are the single source; JSON Schema is generated and turned into Rust types with `typify`. A contract test fails if the generated schema changes without a version bump.

## Alternatives considered

Hand-written OpenAPI as source; Protobuf.

## Consequences

One source without a heavy generator. See ADR 020 for the generated OpenAPI/AsyncAPI.
