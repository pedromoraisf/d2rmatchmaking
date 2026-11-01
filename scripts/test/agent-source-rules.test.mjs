// Static rules of the agent's Rust and Tauri sources (AGS-01, AGS-04, AGS-15, AGS-21, AGS-22, AGS-33). Each rule is checked
// on the repository as it is, and on a fixture under scripts/test/fixtures/agent-rules/ that the rule must reject.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentTauri = 'apps/agent/src-tauri';
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(readText(file));

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ipc: http://ipc.localhost";

// The app's `windows` crate features (design.md § Read-only boundary).
const WINDOWS_FEATURE_ALLOW_LIST = [
  'Win32_Foundation',
  'Win32_System_Diagnostics_ToolHelp',
  'Media_Ocr',
  'Graphics_Imaging',
  'Globalization',
  'Foundation',
  'Storage_Streams',
];

// The only two files that may allow unsafe_code, each with the windows:: paths it may name.
const UNSAFE_ADAPTERS = {
  'src/adapters/toolhelp.rs': [
    'CreateToolhelp32Snapshot',
    'Process32FirstW',
    'Process32NextW',
    'CloseHandle',
    'PROCESSENTRY32W',
    'TH32CS_SNAPPROCESS',
    'HANDLE',
  ],
  'src/adapters/windows_ocr.rs': [
    'Media::Ocr',
    'Graphics::Imaging',
    'Globalization::Language',
    'Storage::Streams',
  ],
};

// Rust files of the app crate. Build output, generated files and the boundary fixtures are not the app's sources.
const rustFiles = (base) => {
  const crateDir = path.join(base, agentTauri);
  if (!existsSync(crateDir)) return [];
  return readdirSync(crateDir, { recursive: true })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((rel) => rel.endsWith('.rs'))
    .filter((rel) => !/^(target|gen|boundary-fixtures)\//.test(rel))
    .map((rel) => ({ rel, text: readFileSync(path.join(crateDir, rel), 'utf8') }));
};

const crateFile = (base, rel) => {
  const file = path.join(base, agentTauri, rel);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

// Expands `use windows::...::{A, B}` groups and simple `windows::A::B` paths into full paths.
const windowsPathsIn = (text) => {
  const paths = [];
  const simple = text.replace(/windows::(?:([\w:]+?)::)?\{([^}]*)\}/g, (_, prefix, names) => {
    for (const name of names
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)) {
      paths.push(prefix ? `${prefix}::${name}` : name);
    }
    return '';
  });
  for (const match of simple.matchAll(/windows::([\w:]+)/g)) paths.push(match[1].replace(/::$/, ''));
  return paths;
};

const isAllowedWindowsPath = (windowsPath, allowed) =>
  allowed.some(
    (entry) =>
      windowsPath === entry || windowsPath.startsWith(`${entry}::`) || windowsPath.endsWith(`::${entry}`),
  );

// Each rule returns the violations it finds under `base`; an empty list passes.
const windowsFeatureViolations = (base) => {
  const manifest = crateFile(base, 'Cargo.toml') ?? '';
  const violations = [];
  for (const block of manifest.matchAll(/^\s*windows\s*=\s*\{([^}]*)\}/gm)) {
    const features = block[1].match(/features\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
    for (const feature of features.matchAll(/"([^"]+)"/g)) {
      if (!WINDOWS_FEATURE_ALLOW_LIST.includes(feature[1])) {
        violations.push(`windows feature ${feature[1]} is not on the allow-list`);
      }
    }
  }
  return violations;
};

const unsafeLocationViolations = (base) =>
  rustFiles(base)
    .filter(({ rel, text }) => /allow\(\s*unsafe_code\s*\)/.test(text) && !(rel in UNSAFE_ADAPTERS))
    .map(({ rel }) => `${rel} allows unsafe_code outside the two adapters`);

const adapterPathViolations = (base) =>
  Object.entries(UNSAFE_ADAPTERS).flatMap(([rel, allowed]) => {
    const text = crateFile(base, rel);
    if (text === undefined) return [];
    return windowsPathsIn(text)
      .filter((windowsPath) => !isAllowedWindowsPath(windowsPath, allowed))
      .map((windowsPath) => `${rel} references windows::${windowsPath}, which is not on its allow-list`);
  });

const instrumentViolations = (base) =>
  rustFiles(base).flatMap(({ rel, text }) =>
    [...text.matchAll(/#\[\s*(?:tracing::)?instrument\b([^\]]*)\]/g)]
      .filter((attribute) => !/\bskip_all\b/.test(attribute[1]))
      .map(() => `${rel} has #[instrument] without skip_all`),
  );

const fixtureReadViolations = (base) => {
  const manifest = crateFile(base, 'Cargo.toml') ?? '';
  const defaults = manifest.match(/^default\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
  return /"fixture-read"/.test(defaults) ? ['Cargo.toml enables fixture-read by default'] : [];
};

const fixtureBase = (name) => path.join(root, 'scripts/test/fixtures/agent-rules', name);

test('windows features stay on the allow-list', () => {
  assert.deepEqual(windowsFeatureViolations(root), []);
});

test('unsafe is allowed only in the two adapters', () => {
  assert.deepEqual(unsafeLocationViolations(root), []);
});

test('unsafe adapters reference only allowed windows paths', () => {
  assert.deepEqual(adapterPathViolations(root), []);
});

test('instrument always skips arguments', () => {
  assert.deepEqual(instrumentViolations(root), []);
});

test('fixture-read is never a default feature', () => {
  assert.deepEqual(fixtureReadViolations(root), []);
});

test('the windows feature rule rejects a feature off the list', () => {
  assert.match(
    windowsFeatureViolations(fixtureBase('windows-feature')).join('\n'),
    /windows feature Win32_System_Diagnostics_Debug is not on the allow-list/,
  );
});

test('the unsafe location rule rejects an allow outside the adapters', () => {
  assert.match(
    unsafeLocationViolations(fixtureBase('unsafe-outside-adapters')).join('\n'),
    /src\/adapters\/http\.rs allows unsafe_code outside the two adapters/,
  );
});

test('the adapter path rule rejects a windows path off the list', () => {
  assert.match(
    adapterPathViolations(fixtureBase('adapter-path')).join('\n'),
    /references windows::Win32::System::Threading::OpenProcess, which is not on its allow-list/,
  );
});

test('the instrument rule rejects arguments without skip_all', () => {
  assert.match(
    instrumentViolations(fixtureBase('instrument-without-skip')).join('\n'),
    /src\/app\.rs has #\[instrument\] without skip_all/,
  );
});

test('the fixture-read rule rejects a default feature', () => {
  assert.match(
    fixtureReadViolations(fixtureBase('fixture-read-default')).join('\n'),
    /Cargo\.toml enables fixture-read by default/,
  );
});

test('the AGS-01 rule rejects a [features] table in core', () => {
  const manifest = readText(
    'scripts/test/fixtures/agent-rules/core-features-table/apps/agent/src-tauri/core/Cargo.toml',
  );
  assert.match(manifest, CORE_FEATURES_TABLE);
});

test('the AGS-01 rule rejects an optional dependency in core', () => {
  const manifest = readText(
    'scripts/test/fixtures/agent-rules/core-optional-dependency/apps/agent/src-tauri/core/Cargo.toml',
  );
  assert.match(manifest, OPTIONAL_DEPENDENCY);
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE, 'this fixture is rejected by the optional rule alone');
});

test('the AGS-01 rule accepts dependency feature lists', () => {
  const manifest = readText(`${agentTauri}/core/Cargo.toml`);
  assert.match(manifest, /features\s*=/, 'core lists features on its dependencies, which AGS-01 allows');
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE);
  assert.doesNotMatch(manifest, OPTIONAL_DEPENDENCY);
});

test('tauri.conf.json keeps the hardened shell', () => {
  const conf = readJson(`${agentTauri}/tauri.conf.json`);
  assert.equal(
    conf.version,
    '../package.json',
    'the version has one source, apps/agent/package.json (AGS-04)',
  );
  assert.equal(conf.build.frontendDist, '../dist');
  assert.equal(conf.build.beforeBuildCommand, '', 'no command runs before the build (release supply chain)');
  assert.equal(conf.build.features, undefined, 'the app enables no build features in the config');
  assert.equal(conf.app.withGlobalTauri, false);
  assert.equal(conf.app.security.csp, CSP);
  assert.deepEqual(
    conf.app.windows.map((window) => window.label),
    ['main'],
    'one window, labelled main',
  );
});

test('the window gets only listen, unlisten and get_new_code', () => {
  const capability = readJson(`${agentTauri}/capabilities/main.json`);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(
    [...capability.permissions].sort(),
    ['allow-get-new-code', 'core:event:allow-listen', 'core:event:allow-unlisten'],
    'no updater, shell, fs or http permission reaches the window',
  );
});

// AGS-01: core declares no Cargo features. A `features = [...]` list on a dependency is not a feature of core; a
// `[features]` table or an `optional = true` dependency (an implicit feature) is.
const CORE_FEATURES_TABLE = /^\s*\[features\]/m;
const OPTIONAL_DEPENDENCY = /\boptional\s*=\s*true\b/;

test('core has no tauri dependency', () => {
  const manifest = readText(`${agentTauri}/core/Cargo.toml`);
  assert.doesNotMatch(manifest, /^\s*tauri[\w-]*\s*[=.]/m, 'core/Cargo.toml names no tauri crate');
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE, 'core/Cargo.toml has no [features] table (AGS-01)');
  assert.doesNotMatch(
    manifest,
    OPTIONAL_DEPENDENCY,
    'core/Cargo.toml has no optional dependency, an implicit feature (AGS-01)',
  );
  for (const file of ['core/src/lib.rs']) {
    assert.doesNotMatch(readText(`${agentTauri}/${file}`), /\btauri\b/, `${file} does not use tauri`);
  }
});

const UPDATER_ENDPOINT =
  'https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/latest.json';
const UPDATER_PUBKEY_PENDING = 'MAINTAINER_PUBKEY_PENDING';

test('updater checks the latest release over https, with no insecure transport', () => {
  const conf = readJson(`${agentTauri}/tauri.conf.json`);
  assert.deepEqual(
    conf.plugins.updater.endpoints,
    [UPDATER_ENDPOINT],
    'the endpoint is the latest release (AD-049)',
  );
  assert.equal(
    conf.plugins.updater.dangerousInsecureTransportProtocol,
    undefined,
    'no insecure transport for the updater (AGS-24)',
  );
  assert.equal(
    conf.bundle.createUpdaterArtifacts,
    true,
    'the updater artifacts are signed at release (AGS-24)',
  );
});

test('updater checks the latest release with the embedded key', () => {
  const pubkey = readJson(`${agentTauri}/tauri.conf.json`).plugins.updater.pubkey;
  assert.notEqual(pubkey, UPDATER_PUBKEY_PENDING, 'the maintainer public key replaces the placeholder');
  assert.match(pubkey, /^[A-Za-z0-9+/=]{20,}$/, 'the public key is base64');
});

// AGS-21 / design.md § Mutation: cargo-mutants examines the seven core rule modules and nothing else.
test('mutation covers the core rule modules', () => {
  const toml = readText(`${agentTauri}/.cargo/mutants.toml`);
  const globs = toml.match(/examine_globs\s*=\s*\[([^\]]*)\]/);
  assert.ok(globs, 'mutants.toml declares examine_globs');
  const scoped = [...globs[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(scoped, [
    'core/src/api_client.rs',
    'core/src/fusion.rs',
    'core/src/heartbeat.rs',
    'core/src/observations.rs',
    'core/src/pairing.rs',
    'core/src/stream.rs',
    'core/src/updates.rs',
  ]);
});

// The read-only boundary's ban lists (design.md § Read-only boundary; ADR 010; NFR-04). Every name below is required: a
// config without it fails. The lists may grow; they may not shrink.
const REQUIRED_BANNED_CRATES = [
  'sysinfo',
  'process-memory',
  'read-process-memory',
  'proc-maps',
  'memprocfs',
  'ntapi',
  'dll-syringe',
  'retour',
  'detour',
  'minhook',
  'enigo',
  'rdev',
  'inputbot',
  'device_query',
  'willhook',
  'rustautogui',
  'autopilot',
  'mouse-rs',
  'pcap',
  'pnet',
  'windivert',
  'winapi',
  'tauri-plugin-shell',
  'tauri-plugin-fs',
  'tauri-plugin-http',
  'tauri-plugin-global-shortcut',
];
const REQUIRED_DISALLOWED_TYPES = ['std::process::Command', 'tokio::process::Command'];
const REQUIRED_DISALLOWED_METHODS = [
  'windows::Win32::System::Diagnostics::ToolHelp::Toolhelp32ReadProcessMemory',
  'windows::Win32::System::Threading::OpenProcess',
  'windows::Win32::System::Diagnostics::Debug::ReadProcessMemory',
  'windows::Win32::System::Diagnostics::Debug::WriteProcessMemory',
  'windows::Win32::UI::Input::KeyboardAndMouse::SendInput',
  'reqwest::ClientBuilder::danger_accept_invalid_certs',
  'reqwest::ClientBuilder::danger_accept_invalid_hostnames',
];

// The body of one `key = [ … ]` list, from its header to the line that closes it.
const listBody = (text, header) => {
  const start = text.indexOf(header);
  if (start < 0) return '';
  return text.slice(start, text.indexOf('\n]', start));
};

const namesIn = (body, pattern) => new Set([...body.matchAll(pattern)].map((match) => match[1]));

const DENY_CRATE = /\{\s*crate\s*=\s*"([^"]+)"/g;
const CLIPPY_PATH = /\{\s*path\s*=\s*"([^"]+)"/g;

const bannedCrateViolations = (deny) => {
  const found = namesIn(listBody(deny, 'deny = ['), DENY_CRATE);
  const missing = REQUIRED_BANNED_CRATES.filter((crate) => !found.has(crate));
  const wildcards = /^wildcards\s*=\s*"deny"/m.test(deny) ? [] : ['deny.toml does not deny wildcards'];
  return [...missing.map((crate) => `deny.toml does not ban crate ${crate}`), ...wildcards];
};

const clippyViolations = (clippy) => {
  const types = namesIn(listBody(clippy, 'disallowed-types = ['), CLIPPY_PATH);
  const methods = namesIn(listBody(clippy, 'disallowed-methods = ['), CLIPPY_PATH);
  return [
    ...REQUIRED_DISALLOWED_TYPES.filter((path) => !types.has(path)).map(
      (path) => `clippy.toml does not disallow type ${path}`,
    ),
    ...REQUIRED_DISALLOWED_METHODS.filter((path) => !methods.has(path)).map(
      (path) => `clippy.toml does not disallow method ${path}`,
    ),
  ];
};

// The config with every line that names `needle` removed: one entry taken out, nothing else changed.
const without = (text, needle) =>
  text
    .split('\n')
    .filter((line) => !line.includes(needle))
    .join('\n');

test('deny.toml bans every crate of the read-only boundary', () => {
  assert.deepEqual(bannedCrateViolations(readText(`${agentTauri}/deny.toml`)), []);
});

test('removing any banned crate from deny.toml fails', () => {
  const deny = readText(`${agentTauri}/deny.toml`);
  for (const crate of REQUIRED_BANNED_CRATES) {
    assert.deepEqual(
      bannedCrateViolations(without(deny, `crate = "${crate}"`)),
      [`deny.toml does not ban crate ${crate}`],
      `removing ${crate} must fail`,
    );
  }
  assert.deepEqual(bannedCrateViolations(deny.replace('wildcards = "deny"', 'wildcards = "allow"')), [
    'deny.toml does not deny wildcards',
  ]);
});

test('clippy.toml disallows every boundary type and method', () => {
  assert.deepEqual(clippyViolations(readText(`${agentTauri}/clippy.toml`)), []);
});

test('removing any disallowed type or method from clippy.toml fails', () => {
  const clippy = readText(`${agentTauri}/clippy.toml`);
  for (const path of REQUIRED_DISALLOWED_TYPES) {
    assert.deepEqual(
      clippyViolations(without(clippy, `path = "${path}"`)),
      [`clippy.toml does not disallow type ${path}`],
      `removing ${path} must fail`,
    );
  }
  for (const path of REQUIRED_DISALLOWED_METHODS) {
    assert.deepEqual(
      clippyViolations(without(clippy, `path = "${path}"`)),
      [`clippy.toml does not disallow method ${path}`],
      `removing ${path} must fail`,
    );
  }
});
