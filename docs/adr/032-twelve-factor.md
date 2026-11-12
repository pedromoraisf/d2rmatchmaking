# ADR 032 — The Twelve-Factor App is a founding principle

**Status**: Accepted
**Date**: 2026-11-12 (accepted 2026-11-12 by the maintainer: "quero que voce adicione uma visão no harness, de respeitar
obrigatoriamente o 12 factor app como um dos principios primordiais https://12factor.net/pt_br/")
**Deciders**: maintainer

## Context

The API (Render) and the site (Cloudflare Pages) are network services deployed from one repository, and the maintainer
wants them held to [The Twelve-Factor App](https://12factor.net/pt_br/) by default. The F1 review showed what happens
when environments drift. The site preview of `phase/F1` talked to the preview API, while the released agent talked to
the `main` API, so the maintainer's real J1 mixed two backends. Staging and production also share one Render service
today. The maintainer moved that split to F2 (2026-11-12: "queria seperar em PRODUCTION e STAGING. vamos adiar esse
trabalho para a fase 2").

## Decision

Every change to the API, the site and their pipelines respects the twelve factors. A change that breaks one needs a new
ADR that names the factor and why. The architecture reviewer checks the factors on every PR (`.claude/agents/
architecture-reviewer.md`), and `AGENTS.md` rule 13 states it.

| Factor                 | What it means here                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Codebase            | One repository; each deploy (production, staging, previews) is a deploy of it, never a fork or a hand-edited copy                                                                                     |
| II. Dependencies       | Declared and locked (`pnpm-lock.yaml`, `Cargo.lock`, `--frozen-lockfile`, `--locked`); no reliance on system tools beyond `AGENTS.md` § Commands                                                      |
| III. Config            | Everything that differs between deploys (URLs, credentials, flags) comes from the environment, read only in `main/` (rule 1); never committed, never branched on a deploy name in code                |
| IV. Backing services   | Postgres (Neon), R2 and the OTLP endpoint are attached resources addressed by URL from config, swappable without a code change                                                                        |
| V. Build, release, run | CI builds once; a release is that build plus config; nothing is patched at run time. Migrations run as a release step (`deploy-api.yml`)                                                              |
| VI. Processes          | Stateless API process; state lives in Postgres. In-memory state (SSE fan-out, timers) is rebuilt from the database on restart (ADR 006 keeps one instance)                                            |
| VII. Port binding      | The API binds `PORT` itself (Fastify); no app server injected                                                                                                                                         |
| VIII. Concurrency      | Scale by process type; the MVP runs one instance by decision (ADR 006) and says so                                                                                                                    |
| IX. Disposability      | Fast start, graceful shutdown on SIGTERM (drain SSE, flush OTLP); a crash loses nothing that is not in Postgres                                                                                       |
| X. Dev/prod parity     | Same backing services in tests (Testcontainers Postgres) as in production; previews and staging run the same build as production, with only config differing. The production/staging split is F2 work |
| XI. Logs               | Event streams to stdout and OTLP (ADR 013); the app never manages log files                                                                                                                           |
| XII. Admin processes   | One-off tasks (migrations, backfills) are scripts in the repository, run against a release with its config, never by hand on a server                                                                 |

**The desktop agent** is not a network service, so factors VI–IX do not apply to it. It keeps III in one bounded way:
its API base URL is a build-time constant (`D2RMM_API_BASE`, ADR 010: the agent accepts no commands and cannot be
pointed at another server by the machine it runs on). Each build target is a separate build of the same code. A
preview build is allowed and is pointed at that preview's API.

## Alternatives considered

- Keep the factors as guidance in a doc: the maintainer asked for them to be mandatory.
- Make the agent's API URL runtime config: it would let local software redirect the agent, against ADR 010.

## Consequences

- Known gaps, owned by F2: the production/staging split (X, and III for per-deploy credentials); a preview agent build,
  so a phase can be played end to end before it merges (X).
- A reviewer FAIL can now cite a factor, like an ADR.
