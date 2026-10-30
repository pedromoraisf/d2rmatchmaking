// Architecture sensor (ADR 004). Runs on edit (Claude Code PostToolUse hook), pre-commit and CI.
// Layer rules per module: domain → application → adapters, and one composition root per provider (main).
// Any change that relaxes a rule here is an escalation (see .claude/skills/d2rmm-phase-runner).
const TESTS = '\\.(test|spec)\\.[cm]?[jt]sx?$|/__tests__/|/test/';
const API = '^apps/api/src';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'Domain imports only its own domain and the shared kernel. No I/O, no frameworks, no node builtins.',
      severity: 'error',
      from: { path: `${API}/modules/[^/]+/domain`, pathNot: TESTS },
      to: { pathNot: [`${API}/modules/[^/]+/domain`, `${API}/shared-kernel`] },
    },
    {
      name: 'application-no-adapters',
      comment: 'Application talks to the world through ports only.',
      severity: 'error',
      from: { path: `${API}/modules/[^/]+/application`, pathNot: TESTS },
      to: { path: ['/adapters/', `${API}/main`, 'node_modules/(fastify|kysely|pg|@opentelemetry/sdk-)'] },
    },
    {
      name: 'no-cross-module-internals',
      comment: 'Modules talk through the public port (modules/<m>/index.ts) or events, never internals.',
      severity: 'error',
      from: { path: `${API}/modules/([^/]+)/` },
      to: {
        path: `${API}/modules/([^/]+)/(domain|application|adapters)/`,
        pathNot: `${API}/modules/$1/`,
      },
    },
    {
      name: 'shared-kernel-is-leaf',
      comment: 'The shared kernel never depends on modules or composition.',
      severity: 'error',
      from: { path: `${API}/shared-kernel`, pathNot: TESTS },
      to: { path: [`${API}/modules`, `${API}/main`] },
    },
    {
      name: 'nobody-imports-main',
      comment: 'main/ is the composition root (the only provider-aware layer). Nothing imports it.',
      severity: 'error',
      from: { pathNot: `${API}/main` },
      to: { path: `${API}/main` },
    },
    {
      name: 'contracts-are-leaf',
      comment:
        'packages/contracts is consumed by api, web and (as JSON Schema) the Rust agent; it imports nothing internal.',
      severity: 'error',
      from: { path: '^packages/contracts/src', pathNot: TESTS },
      to: { path: '^(apps|packages/(telemetry|config))/' },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'web-features-isolated',
      comment: 'Web: features/<ctx> may use shared/ and its own folder; app/ composes.',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/(features/([^/]+)/|app/)', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'acceptance-is-black-box',
      comment:
        'Acceptance tests (ADR 023) drive the system through HTTP, SSE and the browser only. Contracts are allowed.',
      severity: 'error',
      from: { path: '^tests/acceptance/' },
      to: { path: ['^apps/', '^packages/(telemetry|config)/'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          TESTS,
          '\\.d\\.ts$',
          '(^|/)(eslint|vite|vitest|stryker|playwright|tsup)\\.config\\.',
          '^scripts/',
          '^\\.claude/',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-dev-deps-in-runtime',
      severity: 'error',
      from: { path: '^(apps|packages)/[^/]+/src', pathNot: TESTS },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['(^|/)(dist|coverage|target|reports|\\.features-gen)/', '\\.claude/skills/tlc-spec-driven/'],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
