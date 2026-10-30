# ADR 013 — OpenTelemetry to a swappable backend

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

Telemetry from day 0 in three apps without vendor lock-in (NFR-09).

## Decision

OpenTelemetry in web, API and agent; OTLP to Grafana Cloud free for the MVP, configured only in `main/`. The agent's spans link to the API through `traceparent`.

## Alternatives considered

Datadog's proprietary SDK.

## Consequences

Datadog (or any OTLP backend) later is a config change. Free-tier quotas limit sampling; keep attributes free of secrets and PII.
