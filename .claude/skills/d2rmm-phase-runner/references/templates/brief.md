# Phase F<n> — <name>

**Goal**: <one sentence>
**Roadmap**: .specs/phases/ROADMAP.md#f<n>
**Status**: DRAFT — waiting for the maintainer's answers below and the approval line

## How F<n> runs

The lean flow of ADR 029 (`.claude/skills/d2rmm-phase-runner/SKILL.md`): per feature a spec with its Gherkin
scenarios, a design only when Large or Complex, a task checklist, one PR into `phase/F<n>` merged when CI is green.
Mutation runs in the nightly. The maintainer approves this brief and the review; in between only the escalations of
AGENTS.md reach them.

## Exit criteria

- [ ] <observable, provable criterion> — proof: <scenario tag, command or run>

## Features

| Feature        | Size  | Depends on | Parallel | Covers        |
| -------------- | ----- | ---------- | -------- | ------------- |
| <feature-slug> | Large | —          | yes      | FR-xx, NFR-xx |

## Decisions already taken

- <decision> (maintainer, <date>: "<their words>")

## What I need from you

1. <question or input> — options: <a> / <b>. Recommendation: <a>, because <…>.

## Out of scope

## Approval

<!-- **Approved**: <date> - user: "<maintainer's words>" -->
