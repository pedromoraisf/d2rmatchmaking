// Writes the summary whole or not at all (LB-12; design.md § Pure rules). The text goes to a temporary file in the same
// directory and is renamed onto the final name, so a reader finds the old file or the new one, never a part of the new
// one. The smoke profile writes `smoke-summary.json` and never `summary.json` (LB-09). Pure except for the `fs` port.

import { join } from 'node:path';

const FULL_NAME = 'summary.json';
const SMOKE_NAME = 'smoke-summary.json';

/**
 * The file name of a profile's summary.
 * @param {'full' | 'smoke'} profile
 * @returns {string}
 */
export function summaryNameOf(profile) {
  if (profile === 'full') {
    return FULL_NAME;
  }
  if (profile === 'smoke') {
    return SMOKE_NAME;
  }
  throw new TypeError(`unknown profile: ${String(profile)}`);
}

async function discard(fs, path) {
  try {
    await fs.rm(path, { force: true });
  } catch {
    // The temporary file is ours and no target points at it; a failed removal leaves only that file.
  }
}

/**
 * Writes the summary to `dir` whole, or leaves the directory as it was. The failure is rethrown after the temporary
 * file is removed.
 * @param {{
 *   writeFile: (path: string, data: string, options: object) => Promise<void>,
 *   rename: (from: string, to: string) => Promise<void>,
 *   rm: (path: string, options: object) => Promise<void>,
 * }} fs the file port (`node:fs/promises` in the orchestrator)
 * @param {string} dir the directory of the summary
 * @param {{ profile: 'full' | 'smoke' }} summary
 * @returns {Promise<string>} the path of the written summary
 */
export async function writeSummary(fs, dir, summary) {
  const name = summaryNameOf(summary.profile);
  const target = join(dir, name);
  const temporary = join(dir, `.${name}.tmp`);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  try {
    await fs.writeFile(temporary, text, { mode: 0o644 });
    await fs.rename(temporary, target);
  } catch (error) {
    await discard(fs, temporary);
    throw error;
  }
  return target;
}
