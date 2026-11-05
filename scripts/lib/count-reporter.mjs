import path from 'node:path';

// node:test custom reporter (node --test --test-reporter=./scripts/lib/count-reporter.mjs). It prints the result of each
// test, then `<n> passed` and `<n> failed` for the leaf tests, and sets exit code 1 when no test passed or any test
// failed. A proof whose --test-name-pattern matches nothing therefore fails instead of passing with zero tests
// (verification finding 6). Node also reports each test file as a test named by its absolute path, whether or not a
// pattern selected anything in it; that file-level event is not a proof and is not counted. Suites are not counted.

const isSuite = (data) => data.details?.type === 'suite';
const isFileLevel = (data) => path.isAbsolute(data.name);
const isDirective = (data) => data.skip !== undefined || data.todo !== undefined;

export default async function* countReporter(source) {
  let passed = 0;
  let failed = 0;
  let anyFailure = false;
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') {
      continue;
    }
    if (type === 'test:fail') {
      anyFailure = true;
    }
    if (isSuite(data) || isFileLevel(data)) {
      continue;
    }
    if (type === 'test:fail') {
      failed += 1;
      yield `not ok - ${data.name}\n`;
    } else if (isDirective(data)) {
      yield `skip - ${data.name}\n`;
    } else {
      passed += 1;
      yield `ok - ${data.name}\n`;
    }
  }
  yield `${passed} passed\n`;
  yield `${failed} failed\n`;
  if (passed === 0 || anyFailure) {
    process.exitCode = 1;
  }
}
