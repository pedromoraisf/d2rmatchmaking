# ADR 016 — Windows code signing via SignPath Foundation

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Unsigned installers trigger SmartScreen warnings that drive players away.

## Decision

Apply to the SignPath Foundation programme (free for OSI-licensed projects); the repository is MIT.

## Alternatives considered

Microsoft Artifact Signing (paid); no signing at first.

## Consequences

Requires manual approval per release and a published signing policy page. Until accepted, releases are unsigned and the site explains the warning.
