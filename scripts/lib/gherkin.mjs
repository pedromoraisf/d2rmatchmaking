// Minimal, dependency-free Gherkin reader for the acceptance gate (ADR 023).
// It does not replace the official parser used by playwright-bdd at run time; it checks structure, language and
// traceability tags early (on edit, in the spec gate), before any dependency is installed.

const KEYWORD = {
  feature: /^Feature:\s*(.*)$/,
  rule: /^Rule:\s*(.*)$/,
  background: /^Background:\s*(.*)$/,
  outline: /^Scenario (Outline|Template):\s*(.*)$/,
  scenario: /^(Scenario|Example):\s*(.*)$/,
  examples: /^(Examples|Scenarios):\s*(.*)$/,
  step: /^(Given|When|Then|And|But|\*)\s+(.+)$/,
};

/**
 * @returns {{ language: string, feature: string|null, featureTags: string[], scenarios: Array<{name: string, line: number,
 *   tags: string[], outline: boolean, steps: Array<{keyword: string, effective: string, text: string}>, examples: number}>,
 *   backgroundSteps: Array<{keyword: string, effective: string, text: string}>, notScenario: Array<{id: string, reason: string}>,
 *   errors: string[] }}
 */
export function parseFeature(text) {
  const out = {
    language: 'en',
    feature: null,
    featureTags: [],
    scenarios: [],
    backgroundSteps: [],
    notScenario: [],
    errors: [],
  };
  let pendingTags = [];
  let current = null; // scenario | 'background'
  let inDocString = false;
  let featureCount = 0;
  let lastEffective = null;
  let inExamples = false;
  const lines = String(text ?? '').split('\n');

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line.startsWith('"""') || line.startsWith('```')) {
      inDocString = !inDocString;
      return;
    }
    if (inDocString || line === '') return;
    if (line.startsWith('#')) {
      const lang = /^#\s*language:\s*(\S+)/.exec(line);
      if (lang) out.language = lang[1];
      const ns = /^#\s*not-scenario:\s*([A-Z][A-Z0-9]*-\d+)\s*[—–-]+\s*(\S.*)$/.exec(line);
      if (ns) out.notScenario.push({ id: ns[1], reason: ns[2] });
      return;
    }
    if (line.startsWith('@')) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith('@')));
      return;
    }
    if (line.startsWith('|')) {
      if (inExamples && current && current !== 'background') current.examples += 1;
      return;
    }
    let m;
    if ((m = KEYWORD.feature.exec(line))) {
      featureCount += 1;
      out.feature = m[1].trim();
      out.featureTags = pendingTags;
      pendingTags = [];
      return;
    }
    if (KEYWORD.rule.exec(line)) {
      pendingTags = [];
      current = null;
      return;
    }
    if (KEYWORD.background.exec(line)) {
      current = 'background';
      lastEffective = null;
      pendingTags = [];
      inExamples = false;
      return;
    }
    if ((m = KEYWORD.outline.exec(line)) || (m = KEYWORD.scenario.exec(line))) {
      const outline = KEYWORD.outline.test(line);
      current = {
        name: (outline ? m[2] : m[2]).trim(),
        line: n,
        tags: pendingTags,
        outline,
        steps: [],
        examples: 0,
      };
      out.scenarios.push(current);
      pendingTags = [];
      lastEffective = null;
      inExamples = false;
      return;
    }
    if (KEYWORD.examples.exec(line)) {
      inExamples = true;
      if (current && current !== 'background') current.examples -= 1; // the header row is not an example
      pendingTags = [];
      return;
    }
    if ((m = KEYWORD.step.exec(line))) {
      const keyword = m[1];
      const effective = ['And', 'But', '*'].includes(keyword) ? lastEffective : keyword;
      if (!effective) out.errors.push(`line ${n}: "${keyword}" without a preceding Given/When/Then`);
      lastEffective = effective ?? lastEffective;
      const step = { keyword, effective: effective ?? keyword, text: m[2].trim() };
      if (current === 'background') out.backgroundSteps.push(step);
      else if (current) current.steps.push(step);
      else out.errors.push(`line ${n}: step outside a scenario`);
      return;
    }
    if (!current && featureCount > 0) return; // free-form feature description
    if (current) return; // scenario description lines
    out.errors.push(`line ${n}: unexpected line before "Feature:": ${line.slice(0, 60)}`);
  });

  if (featureCount === 0) out.errors.push('no "Feature:" found');
  if (featureCount > 1) out.errors.push('one Feature per file');
  return out;
}
