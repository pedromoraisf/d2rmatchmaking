---
description: Run every local sensor (what CI runs) and summarise failures with the fix for each.
---

Run `pnpm check`. If dependencies are missing, run `pnpm install` first. For each failing step, show the first
relevant error and fix it at the root (never by loosening the sensor, skipping a test or editing the baseline).
Re-run until green or until a fix would need an escalation (see `.claude/skills/d2rmm-phase-runner/references/escalation.md`).
