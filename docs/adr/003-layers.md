# ADR 003 — Layers: domain, application, adapters, main

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

We need the leanest layering that isolates the domain from I/O and the hosting provider from everything else.

## Decision

Three layers per module (`domain`, `application`, `adapters`) plus a global composition layer `main/` per provider (`main/local.ts`, `main/render.ts`). `main/` is the only code that knows it runs on Render, uses Neon or exports to Grafana.

## Alternatives considered

Full hexagonal with more rings; MVC.

## Consequences

Swapping a provider changes only `main/` (NFR-08). Domain code is pure and fast to test; application code is tested with fakes of its ports.
