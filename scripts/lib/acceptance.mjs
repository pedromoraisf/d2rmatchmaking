// Acceptance gate (ADR 023): every requirement of a feature spec is proved by at least one Gherkin scenario
// in .specs/features/<feature>/acceptance.feature, tagged with the requirement ID. The same file is executed by
// playwright-bdd (tests/acceptance), so the approved scenarios ARE the acceptance tests.
import { parseFeature } from './gherkin.mjs';

const ID = /^[A-Z][A-Z0-9]*-\d+$/;
export const FORBIDDEN_TAGS = ['@only', '@skip', '@fixme', '@fail', '@wip', '@ignore', '@todo'];
// Traceability and routing tags that are not the feature's own requirement IDs.
const FOREIGN_ID = /^@(FR|NFR|INV|ADR|AD)-\d+$/;
const ROUTING = /^@(web|api|agent|smoke|slow|serial|chromium|firefox|webkit|mobile)$/;

/** Requirement IDs from the spec's "## Requirement Traceability" table (first column). */
export function requirementIds(specText) {
  const ids = [];
  const section = String(specText ?? '')
    .split(/^## /m)
    .find((s) => /^Requirement Traceability/i.test(s));
  if (!section) return ids;
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const first = line.split('|')[1]?.trim() ?? '';
    if (ID.test(first)) ids.push(first);
  }
  return [...new Set(ids)];
}

/** @returns {string[]} errors */
export function checkAcceptance(feature, specText, featureText) {
  const errors = [];
  const where = `.specs/features/${feature}/acceptance.feature`;
  const ids = requirementIds(specText);
  if (ids.length === 0) return errors; // spec not at the traceability stage yet
  if (featureText === null || featureText === undefined) {
    return [
      `${where} is missing: ${ids.length} requirement(s) need acceptance scenarios (${ids.join(', ')}).`,
    ];
  }
  const f = parseFeature(featureText);
  errors.push(...f.errors.map((e) => `${where}: ${e}`));
  if (f.language !== 'en')
    errors.push(`${where}: Gherkin keywords are English (found "# language: ${f.language}").`);
  if (f.scenarios.length === 0) errors.push(`${where}: no scenarios.`);

  const covered = new Set();
  for (const s of f.scenarios) {
    const label = `${where}:${s.line} "${s.name}"`;
    const tags = [...f.featureTags, ...s.tags];
    for (const t of tags) {
      if (FORBIDDEN_TAGS.includes(t.toLowerCase()))
        errors.push(`${label}: tag ${t} is not allowed (scenarios are never skipped or focused).`);
    }
    const own = s.tags.filter((t) => ID.test(t.slice(1)) && !FOREIGN_ID.test(t));
    if (own.length === 0)
      errors.push(`${label}: tag it with the requirement ID(s) it proves (e.g. @${ids[0]}).`);
    for (const t of own) {
      if (!ids.includes(t.slice(1))) errors.push(`${label}: ${t} is not a requirement of this spec.`);
      else covered.add(t.slice(1));
    }
    for (const t of s.tags) {
      if (
        !ID.test(t.slice(1)) &&
        !FOREIGN_ID.test(t) &&
        !ROUTING.test(t) &&
        !FORBIDDEN_TAGS.includes(t.toLowerCase())
      ) {
        errors.push(`${label}: unknown tag ${t}.`);
      }
    }
    const all = [...f.backgroundSteps, ...s.steps].map((x) => x.effective);
    if (!all.includes('When')) errors.push(`${label}: needs a "When" (the action under test).`);
    if (!s.steps.some((x) => x.effective === 'Then'))
      errors.push(`${label}: needs a "Then" (the observable outcome).`);
    if (s.outline && s.examples < 1) errors.push(`${label}: Scenario Outline without example rows.`);
  }

  const exempt = new Map(f.notScenario.map((x) => [x.id, x.reason]));
  for (const id of ids) {
    if (!covered.has(id) && !exempt.has(id)) {
      errors.push(
        `${where}: requirement ${id} has no scenario (or a "# not-scenario: ${id} — <how it is proved>" line).`,
      );
    }
  }
  for (const [id] of exempt) {
    if (!ids.includes(id)) errors.push(`${where}: not-scenario ${id} is not a requirement of this spec.`);
    if (covered.has(id)) errors.push(`${where}: ${id} has scenarios and a not-scenario line; keep one.`);
  }
  return errors;
}

export function countScenarios(featureText) {
  const f = parseFeature(featureText);
  return f.scenarios.reduce((n, s) => n + (s.outline ? Math.max(1, s.examples) : 1), 0);
}
