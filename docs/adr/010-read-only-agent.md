# ADR 010 — The desktop agent only reads pixels and OS signals

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The agent is mandatory for every player, is not approved by Blizzard, and must never look like a cheat.

## Decision

Window capture cascade (windows-capture), Windows OCR, image processing and OS signals only. Never game memory, code injection, renderer hooks, network interception, capture outside the game window, input that confirms an in-game action, or commands from the server. Input automation is limited to optional typing helpers that never confirm.

## Alternatives considered

Memory reading; network proxy.

## Consequences

Lower signal fidelity (only the game name and chat lines are verifiable); disputes rely on paired observations from both sides. Any change that weakens these limits is a security bug (SECURITY.md).
