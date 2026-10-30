# ADR 015 — Agent release pipeline

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Players must always run the latest agent, for free and automatically.

## Decision

release-please keeps a release PR from Conventional Commits; merging tags `agent-v*`; tauri-action builds on `windows-latest`, signs the updater artifact, publishes `latest.json` and a fixed-name installer `D2RMatchMaking-setup.exe` to GitHub Releases. The Tauri updater checks `releases/latest/download/latest.json`.

## Alternatives considered

Own update server; Microsoft Store.

## Consequences

The site links `releases/latest/download/D2RMatchMaking-setup.exe` without redeploys. `TAURI_SIGNING_PRIVATE_KEY` is a maintainer-created secret.
