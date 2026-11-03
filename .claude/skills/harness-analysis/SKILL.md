---
name: harness-analysis
description: Architecture analysis of a repository's agentic harness (the guides, hooks, sensors, gates, subagents, state, governance and metrics that steer coding agents) with a fixed framework — 10 pillars, 40 criteria scored 0–4, a component inventory and a control-point matrix — so the harness of one repo can be compared with another's. Use when the user asks to analyse, audit, score, document or compare an agent harness, AGENTS.md/CLAUDE.md/hooks setup, or "how the agent tooling of this repo works". Produces a report, a machine-readable scorecard and, on request, a comparison between two scorecards. Read-only on the analysed repo.
---

# Harness Analysis (HAF-1)

Describe **how a repository steers its coding agents** and score it on a frame that never changes between repos.
The frame is in [`references/framework.md`](references/framework.md) — read it to the end before scoring. The fixed
frame is the point: do not add, drop or rename pillars, criteria, kinds, triggers or actions in a report.

## Outputs

1. **Report** — `harness-analysis.md`, every section of [`references/report-template.md`](references/report-template.md)
   in order, in the user's language (IDs and enum values stay in English).
2. **Scorecard** — `harness-scorecard.json` following
   [`references/scorecard.schema.json`](references/scorecard.schema.json): all 40 criteria, inventory, coverage.
3. **Visual page** (when the user wants something easy to read or share) —
   `python3 <this skill>/scripts/render_page.py harness-scorecard.json [other.json] --out <file>.html` embeds the
   scorecard(s) in [`assets/page.html`](assets/page.html): control-point rail, walkthrough, pillar gauges, gaps,
   criteria and a filterable inventory; with two scorecards it shows both and the deltas. Fill the scorecard's
   optional `summary` (verdict, walkthrough, strengths) and `lang` (`en` or `pt-BR`) first. Write the page outside the
   repo (scratchpad) or publish it; it is generated, not a source file.
4. **Comparison** (when there are two scorecards) — `scripts/compare_scorecards.py compare A.json B.json`, then a
   short reading of it following framework §6.

Default location: `docs/harness/` in the analysed repo, unless the user names another place or the repo has an obvious
engineering-docs folder. Never write anywhere else in the analysed repo.

## Procedure

1. **Discover the surface.** `python3 <this skill>/scripts/discover.py <repo-root>` lists candidate files per kind,
   the agent tools configured and the harness's own tests. It finds candidates only; it proves nothing.
2. **Read, don't skim.** Read every entry file (AGENTS.md, CLAUDE.md, rules), every hook and its registration, every
   subagent/skill/command definition, local git hooks, CI workflows, rulesets, baselines and state files. For hooks
   and gate scripts, read the rule code itself — the actual deny/ask conditions, not the comments.
3. **Run what is safe.** Read-only status commands the repo documents (e.g. a `status` script, the harness's own
   test suite, a maturity scorer) give real numbers. Never run anything that writes, pushes, deploys or needs secrets.
   If a command is not clearly read-only, skip it and say so.
4. **Build the inventory** (framework §3). One row per component that acts on its own or that the agent is told to
   follow. `Enforcement = hard` only when code runs it without the agent choosing to.
5. **Fill the coverage matrix** (framework §4). For each control point C1–C12, the components acting there and the
   strongest action among them (`deny` > `ask` > `block` > `fix` > `warn` > `record` > `report` > `inform`).
6. **Score the 40 criteria** (framework §1–2). For each: score, evidence paths (`path:line` where it helps), one-line
   note, and a `next_step` for every score below 3. Apply the "lowest level that covers the whole scope" rule. Look
   actively for holes: a regex shell parser, a tool that gets guides but no guardrails, a metric that is defined but
   `null`, a learning loop that is empty, a ruleset that is documented but imported by hand.
7. **Validate and aggregate.** `python3 <this skill>/scripts/compare_scorecards.py validate harness-scorecard.json`
   must print `ok`; `… summary harness-scorecard.json` gives the pillar scores, profile and gap list for the report.
8. **Write the report** from the template. Section 2 explains the mechanism in plain words: what happens to one unit
   of work from the moment the agent starts to the moment it is merged.
9. **Compare** if a second scorecard exists or the user asks.

## Scoring discipline

- Evidence or zero. A rule nobody can point to does not exist.
- Score the repository, not the analyst's or the user's global setup.
- Same evidence → same score in every repo. When unsure between two levels, take the lower and say why in `note`.
- A strong mechanism with incomplete coverage is scored by its coverage (e.g. a ratchet where half the metrics are
  unmeasured is a 3, not a 4).
- Don't reward volume. Ten documents that repeat each other are one guide; a test suite that only checks happy paths
  is not "self-correcting".
- Name the repo's own terms in notes (its ADR numbers, script names) so the report is checkable.

## Safety

The analysed repo is read-only for this skill except the output folder. Do not edit its hooks, settings, CI or
baselines, even to "fix" a gap — gaps go in the report as next steps. Do not print secrets or `.env*` contents.
