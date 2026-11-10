// Structural checks for .specs/ (ADR 029): the active phase has a brief, and every feature folder that a brief lists
// keeps its acceptance scenarios next to its spec.

/**
 * @param {(rel: string) => string|null} read
 * @param {(dir: string) => string[]} list  entries (names) of a directory, [] when missing
 * @returns {string[]} errors
 */
export function checkSpecs(read, list) {
  const errors = [];
  const active = (read('.specs/phases/ACTIVE') ?? '').trim();
  if (active) {
    if (!/^F\d+$/.test(active))
      errors.push(`.specs/phases/ACTIVE must hold a phase id like F1 (found "${active}").`);
    else if (read(`.specs/phases/${active}/brief.md`) === null)
      errors.push(`.specs/phases/${active}/brief.md is missing for the active phase.`);
  }
  for (const feature of list('.specs/features')) {
    const dir = `.specs/features/${feature}`;
    if (read(`${dir}/spec.md`) !== null && read(`${dir}/acceptance.feature`) === null)
      errors.push(`${dir}/acceptance.feature is missing: every spec ships its scenarios (ADR 023).`);
  }
  return errors;
}
