// What to remove on every exit path, and what a sweep at start removes from an earlier killed run (design.md §
// Orchestrator, § Work directory and credentials; LB-19). Pure: the resources come in as plain data and the plans go out as
// plain data. A name without the run prefix is dropped, so a removal never reaches a resource the run did not name.

const RUN_PREFIX = /^d2rmm-load-[a-z0-9]{8}-/;
const RUN_NAME = /^d2rmm-load-([a-z0-9]{8})(?:-|$)/;
const LABEL = 'd2rmm-load';
const OWNER_MODE = 0o700;

/**
 * @typedef {{ containers?: string[], network?: string | null, workDir?: string | null }} Created
 *   `containers` in start order; `workDir` is the absolute path of the run's work directory.
 * @typedef {{ containers: string[], networks: string[], directories: string[] }} Plan
 */

/**
 * The removals of one run, in the order the orchestrator must run them: containers in reverse start order, then the
 * network, then the work directory. A name that does not carry the run prefix is dropped.
 * @param {Created} [created]
 * @returns {Plan}
 */
export function cleanupPlan(created = {}) {
  const containers = Array.isArray(created.containers) ? created.containers : [];
  return {
    containers: containers.filter(hasRunPrefix).reverse(),
    networks: hasRunPrefix(created.network) ? [created.network] : [],
    directories: isRunDirectory(created.workDir) ? [created.workDir] : [],
  };
}

/**
 * @typedef {{ kind: 'container' | 'network' | 'directory', name: string, labels?: Record<string, string>,
 *   uid?: number, mode?: number, symlink?: boolean }} Found
 *   A directory's `name` is its absolute path; a container or a network is named by its name.
 */

/**
 * The resources of earlier runs that a start removes. Names must match `^d2rmm-load-<8 chars>$` or
 * `^d2rmm-load-<8 chars>-`. A container or a network is kept only when it carries the label `d2rmm-load` with the run id of
 * its own name. A directory is kept only when it is not a symbolic link, belongs to the current uid and has mode 0700.
 * @param {Found[]} found
 * @param {{ uid: number }} current the uid of the running process
 * @returns {Plan}
 */
export function sweepPlan(found, { uid }) {
  const plan = { containers: [], networks: [], directories: [] };
  for (const item of Array.isArray(found) ? found : []) {
    const match = item && typeof item.name === 'string' ? RUN_NAME.exec(leafOf(item.name)) : null;
    if (!match) continue;
    if (item.kind === 'container' && item.labels?.[LABEL] === match[1]) {
      plan.containers.push(item.name);
    } else if (item.kind === 'network' && item.labels?.[LABEL] === match[1]) {
      plan.networks.push(item.name);
    } else if (item.kind === 'directory' && isOwnedDirectory(item, uid)) {
      plan.directories.push(item.name);
    }
  }
  return plan;
}

function hasRunPrefix(name) {
  return typeof name === 'string' && RUN_PREFIX.test(name);
}

function isRunDirectory(path) {
  return typeof path === 'string' && isAbsoluteClean(path) && RUN_PREFIX.test(leafOf(path));
}

function isOwnedDirectory(item, uid) {
  return (
    typeof item.name === 'string' &&
    isAbsoluteClean(item.name) &&
    item.symlink !== true &&
    item.uid === uid &&
    typeof item.mode === 'number' &&
    (item.mode & 0o777) === OWNER_MODE
  );
}

function isAbsoluteClean(path) {
  return path.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(path);
}

function leafOf(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}
