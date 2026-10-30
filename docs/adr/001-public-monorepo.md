# ADR 001 — Public monorepo

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Site, API and desktop agent share contracts and ship together. The agent's updater must read releases without authentication, the project wants free GitHub Actions minutes and the free SignPath Foundation code-signing programme, and players need to audit the agent.

## Decision

One public repository (MIT) with pnpm workspaces and Turborepo: `apps/web`, `apps/api`, `apps/agent`, `packages/contracts`, `packages/telemetry`, `packages/config`.

## Alternatives considered

Separate repositories; public agent with private API.

## Consequences

Contracts live in one place and change atomically with their consumers. Everything is public, so no secret may ever be committed (gitleaks in pre-commit and CI). Turborepo `--affected` keeps CI time proportional to the change.
