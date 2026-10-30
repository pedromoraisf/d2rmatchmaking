// Roadmap coverage (ADR 024): every PRD requirement has exactly one primary phase, and an approved brief covers
// every requirement assigned to its phase. Keeps the five phases complete without anyone remembering the list.
import { approvalsIn } from '../../.claude/hooks/lib/delegation.mjs';

const REQ = /\b(N?FR-\d{2})\b/g;

export function prdRequirements(prdText) {
  const ids = new Set();
  for (const line of String(prdText ?? '').split('\n')) {
    const m = /^\|\s*(N?FR-\d{2})\s*\|/.exec(line);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

export function roadmapCoverage(roadmapText) {
  const map = new Map(); // req -> [phases]
  const section =
    String(roadmapText ?? '')
      .split(/^## /m)
      .find((s) => /^Requirement coverage/.test(s)) ?? '';
  for (const line of section.split('\n')) {
    const m = /^\|\s*(F\d+)\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    for (const r of m[2].match(REQ) ?? []) map.set(r, [...(map.get(r) ?? []), m[1]]);
  }
  return map;
}

/** @returns {string[]} errors */
export function checkRoadmap(prdText, roadmapText, briefs /* {F0: text|null, …} */) {
  const errors = [];
  const reqs = prdRequirements(prdText);
  const cov = roadmapCoverage(roadmapText);
  if (reqs.length === 0) return ['docs/product/prd.md: no FR/NFR table rows found.'];
  for (const r of reqs) {
    const phases = cov.get(r) ?? [];
    if (phases.length === 0) errors.push(`ROADMAP: ${r} has no primary phase.`);
    if (phases.length > 1)
      errors.push(`ROADMAP: ${r} has more than one primary phase (${phases.join(', ')}).`);
  }
  for (const r of cov.keys()) if (!reqs.includes(r)) errors.push(`ROADMAP: ${r} is not in the PRD.`);
  for (const [phase, brief] of Object.entries(briefs)) {
    if (!brief || approvalsIn(brief).length === 0) continue; // drafts may still be incomplete
    const covered = new Set(brief.match(REQ) ?? []);
    for (const [r, phases] of cov) {
      if (phases.includes(phase) && !covered.has(r))
        errors.push(`${phase} brief is approved but does not cover ${r} (primary in ${phase}).`);
    }
  }
  return errors;
}
