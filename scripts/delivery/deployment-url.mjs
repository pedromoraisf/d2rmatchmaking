// The deployment URL of `wrangler pages deploy` (ADR 033). The last `https://` in the output was taken before; a URL that
// is not this project's `pages.dev` host (a docs link, a dashboard URL) would then reach the smoke stage. Only
// `https://<name>.<project>.pages.dev` or `https://<project>.pages.dev` is a deployment URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The last deployment URL of `project` in wrangler's output, or undefined. */
export function deploymentUrl(output, project) {
  if (typeof project !== 'string' || !/^[a-z0-9-]+$/.test(project)) return undefined;
  const host = new RegExp(`^https://(?:[a-z0-9-]+\\.)?${project}\\.pages\\.dev$`);
  const urls = String(output ?? '').match(/https:\/\/[^\s"'<>)\]]+/g) ?? [];
  return urls
    .map((url) => url.replace(/[.,;:]+$/, '').replace(/\/+$/, ''))
    .filter((url) => host.test(url))
    .at(-1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `deployment-url.mjs <log file> <project>`: prints the URL, or exits 1.
  const [file, project] = process.argv.slice(2);
  const url = deploymentUrl(readFileSync(file, 'utf8'), project);
  if (url === undefined) {
    process.stderr.write(`::error::wrangler printed no https://<name>.${project}.pages.dev deployment URL\n`);
    process.exit(1);
  }
  process.stdout.write(`${url}\n`);
}
