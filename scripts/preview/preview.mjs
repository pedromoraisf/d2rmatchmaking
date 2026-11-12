// Pure helpers of the API preview workflows (ADR 030): find the Render preview service of a pull request, validate a
// preview API origin, compute the Pages branch alias, and decide which preview API a branch's site is baked with. The
// CLI at the bottom is what preview-api.yml and deploy-web.yml call, so both bake the same upstream.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASE_SERVICE = 'd2rmm-api';
const PREVIEW_ORIGIN = /^https:\/\/d2rmm-api-pr-[0-9]+\.onrender\.com$/;
const DEFAULT_LINE = 'export const PREVIEW_API_ORIGIN: string | undefined = undefined;';

/**
 * The preview service of pull request `n` in a Render list-services answer (array of `{ service }` entries or of bare
 * services), or undefined. A preview is matched by its parent service name and its own name, never by name alone.
 */
export function pickPreviewService(services, n) {
  if (!Array.isArray(services) || !Number.isInteger(n) || n < 1) return undefined;
  const name = `${BASE_SERVICE}-pr-${n}`;
  return services
    .map((entry) => entry?.service ?? entry)
    .find(
      (service) => service?.name === name && service?.serviceDetails?.parentServer?.name === BASE_SERVICE,
    );
}

/** The origin when it is exactly `https://d2rmm-api-pr-<digits>.onrender.com`, else undefined. */
export function validPreviewOrigin(value) {
  return typeof value === 'string' && PREVIEW_ORIGIN.test(value) ? value : undefined;
}

/**
 * The Cloudflare Pages branch alias: lowercase, every character outside [a-z0-9] becomes '-', then leading and trailing
 * '-' are trimmed (`phase/F1` -> `phase-f1`, `feat/F1-Room_x` -> `feat-f1-room-x`).
 */
export function branchAlias(branch) {
  return String(branch ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The Pages preview origin of a branch, `https://<alias>.<project>.pages.dev`, or undefined when malformed. */
export function previewSiteOrigin(branch, project) {
  if (typeof project !== 'string' || !/^[a-z0-9-]+$/.test(project)) return undefined;
  const alias = branchAlias(branch);
  const origin = `https://${alias}.${project}.pages.dev`;
  return alias !== '' && new RegExp(`^https://[a-z0-9-]+\\.${project}\\.pages\\.dev$`).test(origin)
    ? origin
    : undefined;
}

/**
 * The preview API origin for the open pull requests into main from a branch that carry the `render-preview` label (the
 * JSON of `gh pr list --json number`), or undefined. The lowest number wins when there are several.
 */
export function previewApiOriginFor(pullRequests) {
  if (!Array.isArray(pullRequests)) return undefined;
  const numbers = pullRequests.map((pr) => pr?.number).filter((n) => Number.isInteger(n) && n > 0);
  if (numbers.length === 0) return undefined;
  return validPreviewOrigin(`https://${BASE_SERVICE}-pr-${Math.min(...numbers)}.onrender.com`);
}

/** The module text with the preview API origin baked in; throws when the origin or the default line is wrong. */
export function bakeOrigin(moduleText, origin) {
  if (validPreviewOrigin(origin) === undefined) throw new Error('not a preview API origin');
  if (!moduleText.includes(DEFAULT_LINE)) throw new Error('preview-origin.ts has no default to replace');
  return moduleText.replace(
    DEFAULT_LINE,
    () => `export const PREVIEW_API_ORIGIN: string | undefined = '${origin}';`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'site-origin') {
    // `site-origin <branch> <project>`: the Pages origin of the branch, or exit 1.
    const origin = previewSiteOrigin(args[0], args[1]);
    if (origin === undefined) process.exit(1);
    process.stdout.write(`${origin}\n`);
  } else if (command === 'bake') {
    // `bake <branch> <module file>`: needs GH_TOKEN and GH_REPO. Bakes the origin only when an open pull request into
    // main from the branch carries the label; otherwise leaves the file as committed.
    const json = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--head',
        args[0],
        '--base',
        'main',
        '--label',
        'render-preview',
        '--state',
        'open',
        '--json',
        'number',
      ],
      { encoding: 'utf8' },
    );
    const origin = previewApiOriginFor(JSON.parse(json));
    if (origin === undefined) {
      process.stdout.write('no preview API for this branch\n');
    } else {
      writeFileSync(args[1], bakeOrigin(readFileSync(args[1], 'utf8'), origin));
      process.stdout.write(`baked ${origin}\n`);
    }
  } else if (command === 'find') {
    // `find <n>`: reads a list-services page on stdin, prints "<id> <origin>" of the preview, or nothing when absent.
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    const service = pickPreviewService(JSON.parse(text), Number(args[0]));
    const origin = validPreviewOrigin(service?.serviceDetails?.url);
    if (service && origin) process.stdout.write(`${service.id} ${origin}\n`);
  } else {
    process.stderr.write(
      'usage: preview.mjs find <n> | site-origin <branch> <project> | bake <branch> <file>\n',
    );
    process.exit(2);
  }
}
