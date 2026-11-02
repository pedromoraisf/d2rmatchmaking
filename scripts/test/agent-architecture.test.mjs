// Architecture guard of the agent's crates (ADR 027, AHM-01, AHM-02, AHM-05). Manifest rules: which crate may depend on
// which. Each rule is checked on the repository as it is and on a fixture under
// scripts/test/fixtures/agent-architecture/<fixture>/ that the rule must reject. A rule that is switched off on the real
// tree (its flag in `ENFORCED_NOW`) is still applied to its fixture with the flag on, so the rule is proved before it
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
const CRATE_DIR = { domain: 'domain', core: 'core', adapters: 'adapters', app: '', xtask: 'xtask' };
const CRATE_NAME = {
  domain: 'd2rmm-agent-domain',
  core: 'd2rmm-agent-core',
  adapters: 'd2rmm-agent-adapters',
  app: 'd2rmm-agent',
};

// Whether each deferred rule is enforced on the real tree today. `false` until its task switches it on: a struct in core
// holds at most five ports (T47, when `Context` is gone). Core depends on the domain since T34, so that rule is on. The
// HTTP stack and the contract types left core in T27 and T28, so their rules are on.
const ENFORCED_NOW = { coreDomain: true, coreReqwest: true, coreContracts: true, corePorts: true };

const DOMAIN_ALLOWED = ['thiserror', 'chrono', 'uuid'];
const UI_AND_OS_PREFIXES = ['tauri', 'keyring', 'windows'];

// Dependency names of every dependency table: [dependencies], [dev-dependencies], [build-dependencies],
// [target.<cfg>.dependencies] and the `[dependencies.<name>]` table form. `includeDev: false` leaves out the dev tables:
// a crate that only tests against another crate does not build it.
export const dependencyNames = (manifest, { includeDev = true } = {}) => {
  const names = [];
  let inDependencies = false;
  for (const line of manifest.split('\n')) {
    const header = line.match(/^\s*\[(.+)\]\s*$/);
    if (header) {
      const table = header[1].match(/^(?:target\..+\.)?((?:dev-|build-)?)dependencies(?:\.(.+))?$/);
      const counted = table !== null && (includeDev || table[1] !== 'dev-');
      inDependencies = counted && table[2] === undefined;
      if (counted && table[2] !== undefined) names.push(table[2].replace(/"/g, ''));
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

// The HTTP stack, its JSON and its telemetry belong to the adapters (ADR 027). Core's tests still use some of them as
// dev-dependencies until T29 moves them, so this rule reads the build dependencies only.
const CORE_FORBIDDEN_BUILD = [
  'reqwest',
  'serde_json',
  'opentelemetry',
  'tracing-opentelemetry',
  'tracing-subscriber',
  'regress',
  'url',
];

export const coreViolations = (base, enforce = { domain: false, reqwest: false }) => {
  const manifest = manifestOf(base, 'core');
  if (manifest === undefined) return ['the core manifest is missing'];
  const names = dependencyNames(manifest);
  const violations = names
    .filter((name) => startsWithAny(name, UI_AND_OS_PREFIXES))
    .map((name) => `core depends on ${name}, which is a UI or OS crate`);
  if (enforce.reqwest) {
    const built = dependencyNames(manifest, { includeDev: false });
    violations.push(
      ...built
        .filter((name) => startsWithAny(name, CORE_FORBIDDEN_BUILD))
        .map((name) => `core depends on ${name}`),
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

// The Rust files under one of a crate's directories (`src`, `tests`), with the crate-relative path a violation names.
const rustFiles = (base, crate, sub) => {
  const dir = path.join(base, agentTauri, CRATE_DIR[crate], sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((rel) => rel.endsWith('.rs'))
    .map((rel) => ({
      rel: [CRATE_DIR[crate], sub, rel].filter(Boolean).join('/'),
      code: stripLineComments(readFileSync(path.join(dir, rel), 'utf8')),
    }));
};

const sourceFiles = (base, crate) => rustFiles(base, crate, 'src');

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

// The application reaches the API only through the gateway port: its code names no HTTP client and no adapter type
// (ADR 027, rules 3 and 5). Line comments are excluded, so a doc comment may name the adapter it stands for.
const HTTP_CLIENT = /\breqwest::|\bApiClient\b|\bHttpGateway\b/;

export const coreHttpViolations = (base) =>
  linesMatching(sourceFiles(base, 'core'), HTTP_CLIENT, 'names an HTTP client or an adapter type');

export const domainClockViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), CLOCK_OR_RANDOM, 'reads a clock or randomness');

export const domainAgentNameViolations = (base) =>
  linesMatching(sourceFiles(base, 'domain'), AGENT_ITEM, 'names an item Agent');

// Structural rules (T8).

// The domain's clippy.toml repeats every `path` of the root file and adds the clock and randomness bans (AHM-04).
const CLOCK_BANS = [
  'std::time::Instant',
  'std::time::SystemTime::now',
  'chrono::Utc::now',
  'chrono::Local::now',
  'uuid::Uuid::new_v4',
];
const clippyPaths = (text) => [...text.matchAll(/path = "([^"]+)"/g)].map((match) => match[1]);

export const domainClippyViolations = (base) => {
  const rootFile = path.join(base, agentTauri, 'clippy.toml');
  const domainFile = path.join(base, agentTauri, 'domain', 'clippy.toml');
  if (!existsSync(domainFile)) return ['the domain clippy.toml is missing'];
  if (!existsSync(rootFile)) return ['the root clippy.toml is missing'];
  const domainPaths = clippyPaths(readFileSync(domainFile, 'utf8'));
  const required = [...clippyPaths(readFileSync(rootFile, 'utf8')), ...CLOCK_BANS];
  return [...new Set(required)]
    .filter((banned) => !domainPaths.includes(banned))
    .map((banned) => `domain/clippy.toml does not disallow ${banned}`);
};

// Every agent crate that exists forbids unsafe code and starts no process (ADR 010, AGS-22). A crate with no sources yet
// has nothing to check.
const PROCESS_PATH = /\b(?:std|tokio)::process\b/;

export const crateSafetyViolations = (base) =>
  ['domain', 'core', 'adapters'].flatMap((name) => {
    const files = rustFiles(base, name, 'src');
    if (files.length === 0) return [];
    const lib = `${CRATE_DIR[name]}/src/lib.rs`;
    const forbids = files.some(({ rel, code }) => rel === lib && /#!\[forbid\(unsafe_code\)\]/.test(code));
    return [
      ...(forbids ? [] : [`${lib} does not forbid unsafe code`]),
      ...linesMatching(files, PROCESS_PATH, 'uses std::process or tokio::process'),
    ];
  });

// A struct in core holds at most five ports. A port field is one whose type is a trait object (AHM-17).
const MAX_PORTS = 5;
const STRUCT = /\bstruct\s+(\w+)[^{;]*\{([^}]*)\}/g;

export const corePortViolations = (base, enabled = false) => {
  if (!enabled) return [];
  return rustFiles(base, 'core', 'src').flatMap(({ rel, code }) =>
    [...code.matchAll(STRUCT)]
      .map(([, name, body]) => ({ name, ports: (body.match(/\bdyn\b/g) ?? []).length }))
      .filter(({ ports }) => ports > MAX_PORTS)
      .map(({ name, ports }) => `${rel} struct ${name} holds ${ports} port fields, more than ${MAX_PORTS}`),
  );
};

// Core's tests use in-memory fakes only: no mocking crate (AHM-19, docs/engineering/testing.md rule 2).
const MOCKING = /\bmockall\b|\bmock!/;

export const coreMockViolations = (base) =>
  linesMatching(
    [...rustFiles(base, 'core', 'src'), ...rustFiles(base, 'core', 'tests')],
    MOCKING,
    'uses a mocking crate',
  );

// Only the app crate builds the adapters and depends on tauri, keyring and windows (ADR 027, design composition root).
// A dev-dependency does not count as building: core's tests reach the adapters through one until T29.
export const onlyAppBuildsViolations = (base) =>
  ['domain', 'core', 'adapters', 'xtask'].flatMap((name) => {
    const manifest = manifestOf(base, name);
    if (manifest === undefined) return [];
    const where = `${CRATE_DIR[name]}/Cargo.toml`;
    const built = dependencyNames(manifest, { includeDev: false });
    return [
      ...(built.includes(CRATE_NAME.adapters)
        ? [`${where} depends on ${CRATE_NAME.adapters}, which only the app crate may build`]
        : []),
      ...dependencyNames(manifest)
        .filter((dep) => startsWithAny(dep, UI_AND_OS_PREFIXES))
        .map((dep) => `${where} depends on ${dep}, which only the app crate may depend on`),
    ];
  });

// The app crate never mentions the test probe, so the shipped binary cannot forge agent state (design, AD-082).
const PROBE = /\bProbe\b|\bstart_with_probe\b/;

export const appProbeViolations = (base) => {
  const manifest = path.join(base, agentTauri, 'Cargo.toml');
  const manifestHits =
    existsSync(manifest) && PROBE.test(readFileSync(manifest, 'utf8'))
      ? [`${agentTauri}/Cargo.toml mentions Probe or start_with_probe`]
      : [];
  return [
    ...manifestHits,
    ...linesMatching(rustFiles(base, 'app', 'src'), PROBE, 'mentions Probe or start_with_probe'),
  ];
};

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

test('application reaches the API only through the gateway port', () => {
  assert.deepEqual(coreHttpViolations(root), []);
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

test('domain clippy.toml repeats the root bans and adds the clock bans', () => {
  assert.deepEqual(domainClippyViolations(root), []);
});

test('every agent crate forbids unsafe code and process use', () => {
  assert.deepEqual(crateSafetyViolations(root), []);
});

test('no struct in core holds more than five ports', () => {
  // Switched on in T47 (ENFORCED_NOW.corePorts), when `Context` is gone and no struct holds six ports.
  assert.deepEqual(corePortViolations(root, ENFORCED_NOW.corePorts), []);
});

test('core tests use in-memory fakes only', () => {
  assert.deepEqual(coreMockViolations(root), []);
});

test('only the app crate builds adapters and depends on tauri keyring and windows', () => {
  assert.deepEqual(onlyAppBuildsViolations(root), []);
});

test('the app crate never mentions Probe or start_with_probe', () => {
  assert.deepEqual(appProbeViolations(root), []);
});

// The app crate builds the HTTP client through the adapters and holds no reqwest of its own (ADR 027, AHM-22).
export const appReqwestViolations = (base) => {
  const manifest = manifestOf(base, 'app');
  if (manifest === undefined) return ['the app manifest is missing'];
  return dependencyNames(manifest)
    .filter((name) => startsWithAny(name, ['reqwest']))
    .map((name) => `the app crate depends on ${name}`);
};

test('the app crate never depends on reqwest', () => {
  assert.deepEqual(appReqwestViolations(root), []);
});

// The docs state the layers: AGENTS.md and the cursor rule name the three agent crates and the direction of dependency
// (AHM-06, ADR 027). A doc that lacks either is a violation.
const LAYER_CRATES = [CRATE_NAME.domain, CRATE_NAME.core, CRATE_NAME.adapters];
const LAYER_DIRECTION = 'adapters → application → domain';
const LAYER_DOCS = ['AGENTS.md', '.cursor/rules/agent-rust.mdc'];

export const layerDocViolations = (base) =>
  LAYER_DOCS.flatMap((doc) => {
    const file = path.join(base, doc);
    if (!existsSync(file)) return [`${doc} is missing`];
    const text = readFileSync(file, 'utf8');
    return [
      ...LAYER_CRATES.filter((name) => !text.includes(name)).map(
        (name) => `${doc} does not name the crate ${name}`,
      ),
      ...(text.includes(LAYER_DIRECTION) ? [] : [`${doc} does not state the direction ${LAYER_DIRECTION}`]),
    ];
  });

test('AGENTS.md and the cursor rule state the layer table', () => {
  assert.deepEqual(layerDocViolations(root), []);
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
    name: 'src-core-http',
    check: () => coreHttpViolations(fixtureBase('src-core-http')),
    expect: /core\/src\/lib\.rs names an HTTP client or an adapter type/,
  },
  {
    name: 'src-core-tauri',
    check: () => coreUiOsViolations(fixtureBase('src-core-tauri')),
    expect: /core\/src\/lib\.rs uses a UI or OS crate/,
  },
  {
    name: 'domain-clippy',
    check: () => domainClippyViolations(fixtureBase('domain-clippy')),
    expect: /domain\/clippy\.toml does not disallow chrono::Utc::now/,
  },
  {
    name: 'src-forbid-unsafe',
    check: () => crateSafetyViolations(fixtureBase('src-forbid-unsafe')),
    expect: /domain\/src\/lib\.rs does not forbid unsafe code/,
  },
  {
    name: 'src-process',
    check: () => crateSafetyViolations(fixtureBase('src-process')),
    expect: /core\/src\/lib\.rs uses std::process or tokio::process/,
  },
  {
    name: 'core-ports',
    check: () => corePortViolations(fixtureBase('core-ports'), true),
    expect: /core\/src\/lib\.rs struct Ports holds 6 port fields, more than 5/,
  },
  {
    name: 'core-mock',
    check: () => coreMockViolations(fixtureBase('core-mock')),
    expect: /core\/tests\/fake_api\.rs uses a mocking crate/,
  },
  {
    name: 'core-adapters',
    check: () => onlyAppBuildsViolations(fixtureBase('core-adapters')),
    expect: /core\/Cargo\.toml depends on d2rmm-agent-adapters, which only the app crate may build/,
  },
  {
    name: 'app-reqwest',
    check: () => appReqwestViolations(fixtureBase('app-reqwest')),
    expect: /the app crate depends on reqwest/,
  },
  {
    name: 'app-probe',
    check: () => appProbeViolations(fixtureBase('app-probe')),
    expect: /src\/app\.rs mentions Probe or start_with_probe/,
  },
];

test('each architecture rule fails on its fixture', () => {
  for (const fixture of FIXTURES) {
    const violations = fixture.check();
    assert.notEqual(violations.length, 0, `${fixture.name} must fail its rule`);
    assert.match(violations.join('\n'), fixture.expect, `${fixture.name} must fail with its named rule`);
  }
});
