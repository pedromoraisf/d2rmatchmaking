import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const google = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name === 'no-external-fonts.test.ts' ? [] : [path];
  });
}

describe('fonts are served by the site (LGPD)', () => {
  it('index.html names no Google font host', () => {
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(google);
  });

  it('no source file names a Google font host', () => {
    const offenders = sources(join(root, 'src')).filter((file) => google.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
