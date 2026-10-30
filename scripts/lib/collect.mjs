// Reads sensor reports into a flat { metricName: number } map for the ratchet.
// Each metric's "source" in .quality-baseline.json says where its number comes from.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

export function pointer(obj, ptr) {
  return ptr
    .split('/')
    .slice(1)
    .reduce(
      (o, k) => (o === null || o === undefined ? undefined : o[k.replace(/~1/g, '/').replace(/~0/g, '~')]),
      obj,
    );
}

/** Stryker mutation-testing-report-schema → mutation score (detected / valid, in %). */
export function strykerScore(report) {
  let detected = 0;
  let valid = 0;
  for (const file of Object.values(report?.files ?? {})) {
    for (const m of file.mutants ?? []) {
      if (['CompileError', 'RuntimeError', 'Ignored', 'Pending'].includes(m.status)) continue;
      valid += 1;
      if (m.status === 'Killed' || m.status === 'Timeout') detected += 1;
    }
  }
  return valid === 0 ? null : Math.round((detected / valid) * 10000) / 100;
}

/** cargo-mutants outcomes.json → caught / (caught + missed), in %. Unviable mutants do not count. */
export function cargoMutantsScore(outcomes) {
  const list = outcomes?.outcomes ?? [];
  let caught = 0;
  let missed = 0;
  for (const o of list) {
    const s = JSON.stringify(o.summary ?? o.outcome ?? '');
    if (/CaughtMutant|Timeout/.test(s)) caught += 1;
    else if (/MissedMutant/.test(s)) missed += 1;
  }
  return caught + missed === 0 ? null : Math.round((caught / (caught + missed)) * 10000) / 100;
}

export function harnessField(report, field) {
  if (!report) return undefined; // no report = not measured, never a fake 0
  const maturity = report?.maturity ?? report;
  if (field === 'level') return maturity?.level?.index;
  if (field === 'percent') return maturity?.score?.percent;
  if (field === 'failed') {
    const checks = report?.checks ?? maturity?.checks ?? [];
    return checks.filter((c) => c.applicable !== false && c.passed === false).length;
  }
  return undefined;
}

export function eslintWarnings(results) {
  return Array.isArray(results)
    ? results.reduce((n, r) => n + (r.warningCount ?? 0) + (r.errorCount ?? 0), 0)
    : undefined;
}

export function collect(baseline, root, { harnessReport } = {}) {
  const out = {};
  for (const [name, m] of Object.entries(baseline.metrics ?? {})) {
    const s = m.source ?? {};
    const file = s.path ? path.join(root, s.path) : null;
    let v;
    try {
      if (s.type === 'harness-score')
        v = harnessField(harnessReport ?? readJson(path.join(root, '.harness-score.report.json')), s.field);
      else if (s.type === 'stryker') v = strykerScore(readJson(file));
      else if (s.type === 'cargo-mutants') v = cargoMutantsScore(readJson(file));
      else if (s.type === 'eslint') v = eslintWarnings(readJson(file));
      else if (s.type === 'json') v = pointer(readJson(file), s.pointer ?? '');
    } catch {
      v = undefined;
    }
    if (typeof v === 'number') out[name] = v;
  }
  return out;
}
