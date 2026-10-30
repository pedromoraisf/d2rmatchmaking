// Quality ratchet (ADR 021): metrics in .quality-baseline.json only ever tighten.
// Pure functions, shared by scripts/quality-ratchet.mjs and the PreToolUse gate.

/**
 * Metric shape:
 * { "value": number|null, "direction": "higher"|"lower", "floor"?: number, "ceiling"?: number,
 *   "tolerance"?: number (relative, 0..1), "contexts": ["pr","nightly",...], "source": {...} }
 */

/** List every way `next` is looser than `prev`. Empty list = same or tighter. */
export function compareBaselines(prev, next) {
  const problems = [];
  const pm = prev?.metrics ?? {};
  const nm = next?.metrics ?? {};
  for (const [name, p] of Object.entries(pm)) {
    const n = nm[name];
    if (!n) {
      problems.push(`${name}: metric removed`);
      continue;
    }
    if (n.direction !== p.direction) problems.push(`${name}: direction changed`);
    const higher = p.direction === 'higher';
    if (p.value !== null && p.value !== undefined) {
      if (n.value === null || n.value === undefined) problems.push(`${name}: measured value cleared`);
      else if (higher ? n.value < p.value : n.value > p.value) problems.push(`${name}: value ${p.value} → ${n.value}`);
    }
    if (typeof p.floor === 'number' && !(typeof n.floor === 'number' && n.floor >= p.floor)) {
      problems.push(`${name}: floor ${p.floor} → ${n.floor ?? 'none'}`);
    }
    if (typeof p.ceiling === 'number' && !(typeof n.ceiling === 'number' && n.ceiling <= p.ceiling)) {
      problems.push(`${name}: ceiling ${p.ceiling} → ${n.ceiling ?? 'none'}`);
    }
    if ((n.tolerance ?? 0) > (p.tolerance ?? 0)) problems.push(`${name}: tolerance ${p.tolerance ?? 0} → ${n.tolerance}`);
    const lostCtx = (p.contexts ?? []).filter((c) => !(n.contexts ?? []).includes(c));
    if (lostCtx.length) problems.push(`${name}: no longer checked in ${lostCtx.join(', ')}`);
  }
  return problems;
}

/**
 * Evaluate current measurements against the baseline for one context (pr, nightly, phase…).
 * Returns { failures: string[], notes: string[], improvements: {name: value} }.
 */
export function evaluate(baseline, current, context) {
  const failures = [];
  const notes = [];
  const improvements = {};
  for (const [name, m] of Object.entries(baseline?.metrics ?? {})) {
    if (m.contexts && !m.contexts.includes(context)) continue;
    const v = current?.[name];
    const higher = m.direction === 'higher';
    if (v === undefined || v === null) {
      if (m.value === null || m.value === undefined) notes.push(`${name}: not measured yet`);
      else failures.push(`${name}: was measured (${m.value}) but is missing now — a sensor stopped reporting`);
      continue;
    }
    if (typeof v !== 'number' || Number.isNaN(v)) {
      failures.push(`${name}: not a number (${v})`);
      continue;
    }
    if (typeof m.floor === 'number' && v < m.floor) failures.push(`${name}: ${v} is below the floor ${m.floor}`);
    if (typeof m.ceiling === 'number' && v > m.ceiling) failures.push(`${name}: ${v} is above the ceiling ${m.ceiling}`);
    if (m.value !== null && m.value !== undefined) {
      const tol = m.tolerance ?? 0;
      const limit = higher ? m.value * (1 - tol) : m.value * (1 + tol);
      if (higher ? v < limit : v > limit) failures.push(`${name}: regressed ${m.value} → ${v}${tol ? ` (tolerance ${tol * 100}%)` : ''}`);
    }
    const better = m.value === null || m.value === undefined || (higher ? v > m.value : v < m.value);
    if (better) improvements[name] = v;
  }
  return { failures, notes, improvements };
}

/** Return a new baseline with improvements applied (never loosens). */
export function tighten(baseline, improvements, date) {
  const next = structuredClone(baseline);
  for (const [name, v] of Object.entries(improvements)) {
    if (next.metrics[name]) next.metrics[name].value = v;
  }
  if (Object.keys(improvements).length) next.updated = date;
  return next;
}
