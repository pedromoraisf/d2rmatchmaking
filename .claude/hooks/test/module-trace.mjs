// A Node customisation hook for gate-startup.test.mjs only: it records each rule module the gate imports, one name per
// line, in the file named by D2RMM_TRACE_FILE. Nothing else changes; the gate is not told it is watched.
import { appendFileSync } from 'node:fs';

const RULE_MODULE = /\/scripts\/lib\/(ratchet|acceptance|mutation-scope|model-policy)\.mjs$/;

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const file = process.env.D2RMM_TRACE_FILE;
  const match = RULE_MODULE.exec(resolved.url);
  if (match && file) appendFileSync(file, `${match[1]}\n`);
  return resolved;
}
