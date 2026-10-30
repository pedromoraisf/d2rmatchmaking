# ADR 012 — Same-site session through the Pages proxy

**Status**: Accepted
**Date**: 2026-10-30
**Deciders**: maintainer

## Context

`*.pages.dev` and `*.onrender.com` are different sites; browsers block the session cookie across them, and `EventSource` cannot send an Authorization header.

## Decision

MVP: the site calls the API at same-origin `/api/*`; a Cloudflare Pages Function proxies to Render, so the cookie is first-party. The agent talks to Render directly. When a domain is bought, move to `app.` and `api.` subdomains.

## Alternatives considered

Own domain from day one; token in localStorage.

## Consequences

One extra hop on web requests; SSE must be validated through the Function in F0. Revisit when buying a domain.
