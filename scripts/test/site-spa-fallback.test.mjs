// The site is a single-page app that Cloudflare Pages serves with its SPA fallback: an unknown path answers index.html only
// when the project has no top-level 404.html (Pages "Not found behavior"). The code signing policy lives at /code-signing
// (agent-release AGR-08), so nothing may turn the fallback off. The site's smoke stage asks for the path on a real deploy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tracked = execFileSync('git', ['ls-files', 'apps/web'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((line) => line !== '');

test('the site has no 404.html and no _redirects, so Pages falls back to index.html (AGR-08)', () => {
  assert.ok(tracked.includes('apps/web/index.html'), 'the list holds the site files');
  const offenders = tracked.filter((file) => /(^|\/)(404\.html|_redirects)$/.test(file));
  assert.deepEqual(offenders, []);
});
