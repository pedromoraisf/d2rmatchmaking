// Architecture guard of the agent's crates (ADR 027, AHM-01, AHM-02, AHM-05). Manifest rules: which crate may depend on
// which. Each rule is checked on the repository as it is and on a fixture under
// scripts/test/fixtures/agent-architecture/<fixture>/ that the rule must reject. A rule that is switched off on the real
// tree (its flag in `SWITCHED_OFF`) is still applied to its fixture with the flag on, so the rule is proved before it
// is enforced.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentTauri = 'apps/agent/src-tauri';
const fixtureBase = (name) => path.join(root, 'scripts/test/fixtures/agent-architecture', name);

// Crate directories under apps/agent/src-tauri. The app crate's manifest is the root one.
const CRATE_DIR = { domain: 'domain', core: 'core', adapters: 'adapters', app: '' };
const CRATE_NAME = {
  domain: 'd2rmm-agent-domain',
  core: 'd2rmm-agent-core',
  adapters: 'd2rmm-agent-adapters',
  app: 'd2rmm-agent',
};

// Whether each deferred rule is enforced on the real tree today. `false` until its task switches it on: core depends on
// the domain (T34), core does not depend on reqwest (T28), the application does not use the contract types (T28).
const ENFORCED_NOW = { coreDomain: false, coreReqwest: false, coreContracts: false };

const DOMAIN_ALLOWED = ['thiserror', 'chrono', 'uuid'];
const UI_AND_OS_PREFIXES = ['tauri', 'keyring', 'windows'];

// Dependency names of every dependency table: [dependencies], [dev-dependencies], [build-dependencies],
// [target.<cfg>.dependencies] and the `[dependencies.<name>]` table form.
export const dependencyNames = (manifest) => {
  const names = [];
  let inDependencies = false;
  for (const line of manifest.split('\n')) {
    const header = line.match(/^\s*\[(.+)\]\s*$/);
    if (header) {
      const table = header[1].match(/^(?:target\..+\.)?(?:dev-|build-)?dependencies(?:\.(.+))?$/);
      inDependencies = table !== null && table[1] === undefined;
      if (table?.[1] !== undefined) names.push(table[1].replace(/"/g, ''));
      continue;
    }
    if (!inDependencies) continue;
    const entry = line.match(/^\s*"?([A-Za-z0-9_-]+)"?\s*[.=]/);
    if (entry) names.push(entry[1]);
  }
  return names;
};

const manifestOf = (base, crate) => {
  const file = path.join(base, agentTauri, CRATE_DIR[crate], 'Cargo.toml');
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

const startsWithAny = (name, prefixes) => prefixes.some((prefix) => name.startsWith(prefix));

// Each rule returns the violations it finds under `base`; an empty list passes. A crate that does not exist yet has
// nothing to check (its rules apply once it does).
export const domainViolations = (base) => {
  const manifest = manifestOf(base, 'domain');
  if (manifest === undefined) return ['the domain manifest is missing'];
  return dependencyNames(manifest)
    .filter((name) => !DOMAIN_ALLOWED.includes(name))
    .map((name) => `domain depends on ${name}, which is not std, thiserror, chrono or uuid`);
};

export const coreViolations = (base, enforce = { domain: false, reqwest: false }) => {
  const manifest = manifestOf(base, 'core');
  if (manifest === undefined) return ['the core manifest is missing'];
  const names = dependencyNames(manifest);
  const violations = names
    .filter((name) => startsWithAny(name, UI_AND_OS_PREFIXES))
    .map((name) => `core depends on ${name}, which is a UI or OS crate`);
  if (enforce.reqwest) {
    violations.push(
      ...names.filter((name) => startsWithAny(name, ['reqwest'])).map((name) => `core depends on ${name}`),
    );
  }
  if (enforce.domain && !names.includes(CRATE_NAME.domain)) {
    violations.push(`core does not depend on ${CRATE_NAME.domain}`);
  }
  return violations;
};

export const adaptersViolations = (base) => {
  const manifest = manifestOf(base, 'adapters');
  if (manifest === undefined) return [];
  const names = dependencyNames(manifest);
  return [
    ...names
      .filter((name) => startsWithAny(name, UI_AND_OS_PREFIXES))
      .map((name) => `adapters depends on ${name}, which is a UI or OS crate`),
    ...names
      .filter((name) => name === CRATE_NAME.app)
      .map(() => `adapters depends on the app crate ${CRATE_NAME.app}`),
  ];
};

// Source rules (T7): the `use` and path names of the domain and core `src/**/*.rs`. Line comments are removed first, so a
// doc comment that names a forbidden crate does not count.
const IO_AND_OS_CRATES = [
  'tokio',
  'reqwest',
  'tauri',
  'keyring',
  'windows',
  'serde',
  'serde_json',
  'tracing',
  'zeroize',
];
const IO_PATH = new RegExp(`\\b(?:${IO_AND_OS_CRATES.join('|')})::`);
const UI_OR_OS_PATH = /\b(?:tauri|keyring|windows)::/;
const CONTRACT_PATH = /\b(?:contracts|generated)::/;
const CLOCK_OR_RANDOM =
  /\bInstant\b|\bSystemTime\b|\bUtc::now\b|\bLocal::now\b|\bnew_v4\b|\bstd::env\b|\benv::/;
const AGENT_ITEM = /\b(?:struct|enum|type|trait|union|mod|fn|const|static)\s+Agent\b|::Agent\b/;

const stripLineComments = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

const sourceFiles = (base, crate) => {
  const dir = path.join(base, agentTauri, CRATE_DIR[crate], 'src');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((rel) => rel.endsWith('.rs'))
    .map((rel) => ({
      rel: `${CRATE_DIR[crate]}/src/${rel}`,
      code: stripLineComments(readFileSync(path.join(dir, rel), 'utf8')),
    }));
};

const linesMatching = (files, pattern, message) =>
  files.flatMap(({ rel, code }) => (pattern.test(code) ? [`${rel} ${message}`] : []));

export const domainIoViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), IO_PATH, 'uses an I/O, UI, OS or serialisation crate');

export const coreUiOsViolations = (base) =>
  linesMatching(sourceFiles(base, 'core'), UI_OR_OS_PATH, 'uses a UI or OS crate');

export const domainContractViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), CONTRACT_PATH, 'uses a generated contract type');

export const coreContractViolations = (base, enabled = false) =>
  enabled ? linesMatching(sourceFiles(base, 'core'), CONTRACT_PATH, 'uses a generated contract type') : [];

export const domainClockViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), CLOCK_OR_RANDOM, 'reads a clock or randomness');

export const domainAgentNameViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), AGENT_ITEM, 'names an item Agent');

test('domain imports no I/O or UI crate, and core no UI or OS crate', () => {
  assert.deepEqual([...domainIoViolations(root), ...coreUiOsViolations(root)], []);
});

test('contract types stay out of the domain and the application', () => {
  // The application half is switched on in T28 (ENFORCED_NOW.coreContracts).
  assert.deepEqual(
    [...domainContractViolations(root), ...coreContractViolations(root, ENFORCED_NOW.coreContracts)],
    [],
  );
});

test('domain reads no clock or randomness and names nothing Agent', () => {
  assert.deepEqual([...domainClockViolations(root), ...domainAgentNameViolations(root)], []);
});

test('domain depends only on std thiserror chrono and uuid', () => {
  assert.deepEqual(domainViolations(root), []);
});

test('core depends on the domain and not on reqwest tauri keyring or windows', () => {
  // The `depends on the domain` part is switched on in T34 and the `reqwest` part in T28 (ENFORCED_NOW).
  assert.deepEqual(
    coreViolations(root, { domain: ENFORCED_NOW.coreDomain, reqwest: ENFORCED_NOW.coreReqwest }),
    [],
  );
});

test('adapters never depend on tauri keyring or windows', () => {
  assert.deepEqual(
    adaptersViolations(root).filter((v) => !v.includes('the app crate')),
    [],
  );
});

test('adapters and the app crate do not depend on each other', () => {
  // One direction only: the app crate depends on the adapters to wire them (design.md), so the adapters must not
  // depend on the app crate.
  assert.deepEqual(
    adaptersViolations(root).filter((v) => v.includes('the app crate')),
    [],
  );
});

// Each rule must reject its own fixture. The fixture tree mirrors apps/agent/src-tauri.
const FIXTURES = [
  {
    name: 'domain-tokio',
    check: () => domainViolations(fixtureBase('domain-tokio')),
    expect: /domain depends on tokio, which is not std, thiserror, chrono or uuid/,
  },
  {
    name: 'core-tauri',
    check: () => coreViolations(fixtureBase('core-tauri')),
    expect: /core depends on tauri-plugin-dialog, which is a UI or OS crate/,
  },
  {
    name: 'core-no-domain',
    check: () => coreViolations(fixtureBase('core-no-domain'), { domain: true, reqwest: false }),
    expect: /core does not depend on d2rmm-agent-domain/,
  },
  {
    name: 'core-reqwest',
    check: () => coreViolations(fixtureBase('core-reqwest'), { domain: false, reqwest: true }),
    expect: /core depends on reqwest/,
  },
  {
    name: 'adapters-keyring',
    check: () => adaptersViolations(fixtureBase('adapters-keyring')),
    expect: /adapters depends on keyring, which is a UI or OS crate/,
  },
  {
    name: 'adapters-app',
    check: () => adaptersViolations(fixtureBase('adapters-app')),
    expect: /adapters depends on the app crate d2rmm-agent/,
  },
  {
    name: 'src-domain-io',
    check: () => domainIoViolations(fixtureBase('src-domain-io')),
    expect: /domain\/src\/lib\.rs uses an I\/O, UI, OS or serialisation crate/,
  },
  {
    name: 'src-domain-contracts',
    check: () => domainContractViolations(fixtureBase('src-domain-contracts')),
    expect: /domain\/src\/lib\.rs uses a generated contract type/,
  },
  {
    name: 'src-domain-clock',
    check: () => domainClockViolations(fixtureBase('src-domain-clock')),
    expect: /domain\/src\/lib\.rs reads a clock or randomness/,
  },
  {
    name: 'src-domain-agent',
    check: () => domainAgentNameViolations(fixtureBase('src-domain-agent')),
    expect: /domain\/src\/lib\.rs names an item Agent/,
  },
  {
    name: 'src-core-contracts',
    check: () => coreContractViolations(fixtureBase('src-core-contracts'), true),
    expect: /core\/src\/lib\.rs uses a generated contract type/,
  },
  {
    name: 'src-core-tauri',
    check: () => coreUiOsViolations(fixtureBase('src-core-tauri')),
    expect: /core\/src\/lib\.rs uses a UI or OS crate/,
  },
];

test('each architecture rule fails on its fixture', () => {
  for (const fixture of FIXTURES) {
    const violations = fixture.check();
    assert.notEqual(violations.length, 0, `${fixture.name} must fail its rule`);
    assert.match(violations.join('\n'), fixture.expect, `${fixture.name} must fail with its named rule`);
  }
});
