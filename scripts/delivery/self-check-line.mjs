// The verdict of an installer's smoke start (ADR 033, DLP-06; lessons 2026-11-19: a binary handed to a human is started by
// CI first). `app.exe --self-check --online` prints one JSON line `{ ok, channel, version, checks }`. The build is accepted
// only when every check passed, the line names the channel that was built (so a preview is never shipped as a staging
// installer) and it carries a version. The line holds names and verdicts only: no URL, no secret.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The problems of a self-check output for the channel that was built; an empty list means accepted. */
export function selfCheckProblems(text, channel) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length !== 1) return [`expected one JSON line, got ${lines.length}`];
  let line;
  try {
    line = JSON.parse(lines[0]);
  } catch {
    return ['the line is not JSON'];
  }
  const problems = [];
  if (line.ok !== true) problems.push('the self-check did not pass');
  if (line.channel !== channel)
    problems.push(`the build says channel "${line.channel}", expected "${channel}"`);
  if (typeof line.version !== 'string' || !/^\d+\.\d+\.\d+/.test(line.version))
    problems.push('the line has no version');
  const checks = Array.isArray(line.checks) ? line.checks : [];
  for (const name of ['config', 'ocr', 'health', 'channel']) {
    const found = checks.find((check) => check?.name === name);
    if (found === undefined) problems.push(`the check "${name}" did not run (--online expected)`);
    else if (found.ok !== true) problems.push(`the check "${name}" failed`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `self-check-line.mjs <output file> <channel>`
  const [file, channel] = process.argv.slice(2);
  const problems = selfCheckProblems(readFileSync(file, 'utf8'), channel);
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`the ${channel} build started and passed its self-check\n`);
}
