// A promotion copies files out of the promoted commit into the workspace that holds the secrets (ADR 033). A symlink in
// that tree could point at a file of the runner, so the copy is refused when the tree holds one, the tree root included.
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every symlink in `root` (the root itself included), as paths relative to `root`'s parent; `[]` for a clean tree. */
export function findSymlinks(root) {
  const found = [];
  const visit = (entry) => {
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink()) {
      found.push(entry);
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(entry)) visit(path.join(entry, name));
    }
  };
  visit(root);
  return found.map((entry) => path.relative(path.dirname(root), entry));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `no-symlinks.mjs <dir>`: exits 1 and names each symlink when there is one; also when the directory is missing.
  const dir = process.argv[2];
  let found;
  try {
    found = findSymlinks(dir);
  } catch {
    process.stderr.write(`::error::${dir} cannot be read\n`);
    process.exit(1);
  }
  if (found.length > 0) {
    process.stderr.write(`::error::The promoted tree holds a symlink: ${found.join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`${dir} holds no symlink\n`);
}
