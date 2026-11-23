// The guard of `LOAD_TELEMETRY_CAPTURE_DIR`: the sink writes raw OTLP bodies there, and those hold attribute values, so
// the directory must never be inside the repository (a later `git add` would commit them). Symlinks and `..` are
// resolved before the comparison.

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** The real path of `target`, or of its nearest existing ancestor with the missing tail put back. */
export function resolvedPathOf(target, realpath = realpathSync) {
  let existing = resolve(target);
  const tail = [];
  for (;;) {
    try {
      return resolve(realpath(existing), ...tail);
    } catch (error) {
      const parent = dirname(existing);
      if (parent === existing) throw error;
      tail.unshift(existing.slice(parent.length + 1));
      existing = parent;
    }
  }
}

/**
 * The reason the capture directory is refused, or null when it is outside the repository.
 * @param {string} directory the value of `LOAD_TELEMETRY_CAPTURE_DIR`
 * @param {string} root the repository root
 * @param {(path: string) => string} [realpath]
 * @returns {string | null}
 */
export function captureDirProblem(directory, root, realpath = realpathSync) {
  const inside = relative(resolvedPathOf(root, realpath), resolvedPathOf(directory, realpath));
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    return 'LOAD_TELEMETRY_CAPTURE_DIR resolves inside the repository; the captures hold attribute values and must never be committed. Use a directory outside it, for example under $TMPDIR.';
  }
  return null;
}
