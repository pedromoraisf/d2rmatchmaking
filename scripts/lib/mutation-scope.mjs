// Mutation scope (ADR 026): a mutation is only ever proved by UNIT tests.
//
// A unit test exercises one module through its public interface with fakes: no server, no database, no browser,
// no container, no assembled service. Anything that boots the service is integration, e2e or acceptance; those sit
// at the top of the pyramid (few, slow) and never run once per mutation.
//
//   Rust        `cargo nextest run|cargo test` with `-p <crate> --lib` (the `#[cfg(test)]` modules under src/).
//               The `tests/` directory of a crate is integration; `--workspace`, `--test`, `--tests`, `--bins`,
//               `--all-targets`, `--doc` are refused.
//   TypeScript  `vitest run <path under src/>` on colocated unit tests (domain/application, next to the code). Integration, e2e, acceptance and load paths,
//               Playwright, Testcontainers and k6 are refused.
//   Harness     `node --test <file>` on a file under scripts/test or .claude/hooks/test (they read config files and
//               call pure functions; they assemble nothing).

const RUST_RUNNER = /\bcargo\s+(?:nextest\s+run|test)\b/;
const NODE_TEST = /\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*--test\b/;
const VITEST = /\b(?:vitest|pnpm\s+(?:exec\s+)?vitest)\s+run\b/;
const HEAVY_PATH =
  /(?:^|[\s/'"=])(?:integration|e2e|acceptance|load|testcontainers|playwright|k6)(?:[\s/'".:-]|$)/i;
const HEAVY_TOOL =
  /\b(?:playwright|bddgen|k6|docker|testcontainers|test:integration|test:e2e|test:acceptance)\b/i;
const RUST_WIDE_FLAGS = [
  [/--workspace\b/, '--workspace builds every crate, including the app'],
  [/(?:^|\s)--all(?=\s|$)/, '--all builds every crate'],
  [/--all-targets\b/, '--all-targets includes integration tests'],
  [/--tests\b/, '--tests selects the tests/ directory (integration)'],
  [/(?:^|\s)--test(?:\s|=)/, '--test selects one integration binary under tests/'],
  [/(?:^|\s)--bins?\b/, '--bin(s) selects binaries, not unit tests'],
  [/--examples?\b/, '--example(s) is not a unit test'],
  [/--benches\b|--bench\b/, '--bench(es) is not a unit test'],
  [/--doc\b/, '--doc runs documentation tests'],
];
const HARNESS_TEST_DIR =
  /(?:^|[\s'"])(?:\.\/)?(?:scripts\/test|\.claude\/hooks\/test)\/[\w./-]+\.test\.mjs\b/;

/**
 * @param {string} proof the command that proves one mutation
 * @returns {{ ok: true, kind: 'rust'|'node'|'vitest' } | { ok: false, reason: string }}
 */
export function classifyProof(proof) {
  const cmd = String(proof ?? '').trim();
  if (!cmd) return { ok: false, reason: 'the mutation has no proof command' };

  if (RUST_RUNNER.test(cmd)) {
    for (const [re, why] of RUST_WIDE_FLAGS) {
      if (re.test(cmd)) return { ok: false, reason: `${why}; mutation proofs run unit tests only (ADR 026)` };
    }
    if (!/(?:^|\s)(?:-p|--package)(?:\s|=)\S+/.test(cmd)) {
      return { ok: false, reason: 'name the crate with -p <crate> so only that crate is rebuilt (ADR 026)' };
    }
    if (!/(?:^|\s)--lib\b/.test(cmd)) {
      return {
        ok: false,
        reason: 'add --lib: only the #[cfg(test)] unit tests of src/ prove a mutation (ADR 026)',
      };
    }
    return { ok: true, kind: 'rust' };
  }

  if (NODE_TEST.test(cmd)) {
    if (!HARNESS_TEST_DIR.test(cmd)) {
      return {
        ok: false,
        reason:
          'node --test proves a mutation only from a file under scripts/test or .claude/hooks/test (ADR 026)',
      };
    }
    return { ok: true, kind: 'node' };
  }

  if (VITEST.test(cmd)) {
    if (HEAVY_PATH.test(cmd) || HEAVY_TOOL.test(cmd)) {
      return {
        ok: false,
        reason: 'integration, e2e, acceptance and load tests never prove a mutation (ADR 026)',
      };
    }
    const underSrc = /(?:^|[\s'"=])(?:\.\/)?(?:[\w.@-]+\/)*src\/\S*/.test(cmd);
    if (!underSrc && !/\S+\.test\.tsx?\b/.test(cmd)) {
      return {
        ok: false,
        reason:
          'name the unit test file (*.test.ts) or the src/ directory that proves the mutation (ADR 026)',
      };
    }
    return { ok: true, kind: 'vitest' };
  }

  if (HEAVY_TOOL.test(cmd)) {
    return {
      ok: false,
      reason: 'integration, e2e, acceptance and load tools never prove a mutation (ADR 026)',
    };
  }
  return {
    ok: false,
    reason:
      'not a recognised unit-test runner (cargo nextest -p <crate> --lib, vitest run <file>, node --test <harness file>) (ADR 026)',
  };
}

/**
 * Validate a mutate.py spec (the parsed mutations.json of a feature).
 * @returns {string[]} one message per mutation that breaks the rule
 */
export function checkMutationSpec(spec) {
  if (!Array.isArray(spec)) return ['mutations.json must be a JSON array of mutations'];
  const errors = [];
  spec.forEach((m, i) => {
    const verdict = classifyProof(m?.proof);
    if (!verdict.ok) {
      const label = m?.label ? `"${String(m.label).slice(0, 60)}"` : `#${i + 1}`;
      errors.push(`mutation ${label}: ${verdict.reason}`);
    }
  });
  return errors;
}
