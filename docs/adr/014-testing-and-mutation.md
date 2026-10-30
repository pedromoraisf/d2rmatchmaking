# ADR 014 — Test pyramid with mutation testing

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Line coverage does not show whether tests catch bugs, and agents can write tests that assert nothing.

## Decision

Unit → integration (Testcontainers) → contract → e2e (Playwright) → load (k6). Mutation testing with StrykerJS on domain (floor 80%) and application (70%), and cargo-mutants on the agent core (70%). Incremental on PRs, full nightly. Floors live in `.quality-baseline.json`.

## Alternatives considered

Coverage targets.

## Consequences

Thresholds only tighten (ADR 021 ratchet). Calibrate after the first measurements in F0.
