# ADR 005 — Hosting: Cloudflare Pages, Render free, Neon free

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

The MVP must cost zero (NFR-07). Vercel Hobby forbids commercial use.

## Decision

Web on Cloudflare Pages, API on Render free web service, Postgres on Neon free, prints on Cloudflare R2, CI and releases on GitHub.

## Alternatives considered

Vercel; Railway; Fly.io; an Oracle free VM.

## Consequences

Render sleeps after 15 min idle and has 5 GB/month egress; Neon scales to zero after 5 min and has 100 CU-hours. Payloads, heartbeats and DB writes are designed around those limits. Revisit when leaving the free tier.
