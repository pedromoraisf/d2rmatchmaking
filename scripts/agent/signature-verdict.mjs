#!/usr/bin/env node
// The verdict on the Authenticode signature of the installer to be published (AGR-04). PowerShell's
// `Get-AuthenticodeSignature` gives the status and the signer's subject; this decides pass or fail against the expected
// publisher (the repository variable SIGNPATH_PUBLISHER). Nothing is published as signed unless it passes.
//
//   echo '{"status":"Valid","subject":"CN=..., O=..."}' | node scripts/agent/signature-verdict.mjs --expected "<publisher>"
//
// The expected publisher matches the CN or the O of the subject exactly. Empty means "not configured" and always fails.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The `key=value` pairs of a distinguished name, honouring quoted values with commas. */
export function parseSubject(subject) {
  const pairs = [];
  let current = '';
  let quoted = false;
  for (const char of String(subject ?? '')) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      pairs.push(current);
      current = '';
    } else current += char;
  }
  pairs.push(current);
  return pairs
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('='))
    .map((pair) => [
      pair.slice(0, pair.indexOf('=')).trim().toUpperCase(),
      pair.slice(pair.indexOf('=') + 1).trim(),
    ]);
}

/** @returns {{ ok: true } | { ok: false, reason: string }} */
export function signatureVerdict({ status, subject, expected }) {
  const publisher = String(expected ?? '').trim();
  if (publisher === '') return { ok: false, reason: 'not configured: SIGNPATH_PUBLISHER is empty' };
  if (status !== 'Valid')
    return { ok: false, reason: `the installer's signature is ${String(status ?? 'missing')}, not Valid` };
  const names = parseSubject(subject)
    .filter(([key]) => key === 'CN' || key === 'O')
    .map(([, value]) => value);
  if (!names.includes(publisher)) {
    return { ok: false, reason: 'the installer is signed by another publisher than the expected one' };
  }
  return { ok: true };
}

function main(argv) {
  const at = argv.indexOf('--expected');
  const expected = at >= 0 ? (argv[at + 1] ?? '') : '';
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const verdict = signatureVerdict({ status: input?.status, subject: input?.subject, expected });
  if (!verdict.ok) {
    process.stderr.write(`::error::${verdict.reason}\n`);
    process.exit(1);
  }
  process.stdout.write('the installer carries a valid signature from the expected publisher\n');
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
