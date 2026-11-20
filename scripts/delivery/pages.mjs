// Where a site deploy goes on Cloudflare Pages (ADR 033, DLP-03, DLP-08). Pure rules; the CLI prints the branch a deploy
// passes to `wrangler pages deploy --branch`, so the workflow holds no logic of its own.
import { fileURLToPath } from 'node:url';
import { MAX_ALIAS_LENGTH, branchAlias } from '../preview/preview.mjs';

/** The one alias every phase branch deploys to, so a single redirect URL is registered at Blizzard (DLP-08). */
export const PHASE_PREVIEW_BRANCH = 'phase-preview';
/** The preview alias of staging: a Pages preview deployment, fed by every commit on main. */
export const STAGING_BRANCH = 'staging';
/** The Pages production branch: only a promotion deploys here. */
export const PRODUCTION_BRANCH = 'main';

/**
 * Names a preview may never take: a preview deployed with `--branch main` or `--branch staging` would publish to
 * production or staging without the promote gate, and `phase-preview` is the phase alias only a `phase/*` branch reaches.
 */
export const RESERVED_BRANCHES = ['main', 'staging', 'production', PHASE_PREVIEW_BRANCH];

/**
 * The Pages branch of a deploy. `environment` is preview, staging or production; `branch` is the Git branch that
 * triggered a preview. Throws for a preview whose alias Cloudflare would shorten by a rule not verified here.
 */
export function pagesBranchFor(environment, branch) {
  if (environment === 'staging') return STAGING_BRANCH;
  if (environment === 'production') return PRODUCTION_BRANCH;
  if (environment !== 'preview') throw new Error(`unknown environment "${environment}"`);
  if (/^phase\/[^/]+$/.test(String(branch ?? ''))) return PHASE_PREVIEW_BRANCH;
  const alias = branchAlias(branch);
  const raw = String(branch ?? '').toLowerCase();
  if (RESERVED_BRANCHES.includes(raw) || RESERVED_BRANCHES.includes(alias)) {
    throw new Error(
      `the branch "${branch}" is a reserved Pages name (${RESERVED_BRANCHES.join(', ')}); a preview cannot use it`,
    );
  }
  if (alias === '' || alias.length > MAX_ALIAS_LENGTH) {
    throw new Error(`no usable Pages alias for branch "${branch}"`);
  }
  return String(branch);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [environment, branch] = process.argv.slice(2);
  try {
    process.stdout.write(`${pagesBranchFor(environment, branch)}\n`);
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    process.exit(1);
  }
}
