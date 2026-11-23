// ADR 038: the API's Stryker disable comments carry a reason, name one mutator and stay on the code they cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disableProblems, testingFolderProblems, treeProblems } from '../api/mutation-disables.mjs';

const ok = (code) => assert.deepEqual(disableProblems(code, 'f.ts'), []);
const fails = (code, pattern) => {
  const problems = disableProblems(code, 'f.ts');
  assert.ok(
    problems.some((problem) => pattern.test(problem)),
    `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`,
  );
};

test('the API source has no disable comment that breaks the rules, and no product file lives in testing/', () => {
  assert.deepEqual(treeProblems(), []);
  assert.deepEqual(testingFolderProblems(), []);
});

test('a well-formed disable with a reason on a matching line passes', () => {
  ok(
    '// Stryker disable next-line StringLiteral: equivalent — message of an unreachable throw\nthrow new Error("x");',
  );
  ok('// Stryker disable next-line ConditionalExpression: equivalent — guard\nif (a) return;');
  ok('// Stryker disable next-line BlockStatement: equivalent — cleanup\nif (x) {');
  ok('// Stryker disable next-line EqualityOperator: equivalent — bound\nif (a <= b) return;');
  ok('// Stryker disable next-line LogicalOperator: equivalent — same\nconst v = a && b;');
  ok('// Stryker disable next-line BooleanLiteral: equivalent — flag\nconst v = true;');
  ok('// Stryker disable next-line ArithmeticOperator: equivalent — sum\nconst v = a + b;');
  ok('// Stryker disable next-line MethodExpression: equivalent — order\nconst v = list.filter(isOk);');
  ok('// Stryker disable next-line OptionalChaining: equivalent — never null\nconst v = a?.b;');
  ok('// Stryker disable next-line CallExpression: equivalent — cleanup\ncache.delete(key);');
  ok('const v = a && b; // Stryker disable-line LogicalOperator: equivalent — same');
});

test('a file with no Stryker comment has no problem', () => {
  ok('const a = 1;\n// an ordinary comment\n');
});

test('negative: no reason', () => {
  fails('// Stryker disable next-line StringLiteral\nconst a = "x";', /no reason/);
  fails('// Stryker disable next-line StringLiteral:\nconst a = "x";', /no reason/);
});

test('negative: no mutator name', () => {
  fails('// Stryker disable next-line: equivalent — why\nconst a = "x";', /no mutator/);
});

test('negative: disable all, in every form', () => {
  fails('// Stryker disable all: equivalent — why\nconst a = "x";', /all/);
  fails('// Stryker disable next-line all: equivalent — why\nconst a = "x";', /all/);
});

test('negative: disable-line without a mutator', () => {
  fails('const a = "x"; // Stryker disable-line', /no mutator/);
  fails('const a = "x"; // Stryker disable-line: equivalent — why', /no mutator/);
});

test('negative: more than one mutator, or an unknown one', () => {
  fails(
    '// Stryker disable next-line StringLiteral,BooleanLiteral: equivalent — why\nconst a = "x";',
    /one mutator/,
  );
  fails('// Stryker disable next-line NoSuchMutator: equivalent — why\nconst a = "x";', /unknown mutator/);
});

test('negative: a reason that does not start with "equivalent — "', () => {
  fails('// Stryker disable next-line StringLiteral: because\nconst a = "x";', /equivalent — /);
  fails(
    '// Stryker disable next-line StringLiteral: equivalent - ascii dash\nconst a = "x";',
    /equivalent — /,
  );
  fails(
    '// Stryker disable next-line StringLiteral: equivalent — \nconst a = "x";',
    /equivalent — |no reason/,
  );
});

test('negative: the block disable form', () => {
  const problems = disableProblems(
    '// Stryker disable StringLiteral: equivalent — why\nconst a = "x";',
    'f.ts',
  );
  assert.ok(problems.some((problem) => /block form/.test(problem)));
});

test('negative: nothing to disable below the comment', () => {
  fails(
    '// Stryker disable next-line StringLiteral: equivalent — why\n\nconst a = "x";',
    /nothing to disable/,
  );
  fails(
    '// Stryker disable next-line StringLiteral: equivalent — why\n// another comment\nconst a = "x";',
    /comment/,
  );
  fails('const a = 1;\n// Stryker disable next-line StringLiteral: equivalent — why', /nothing to disable/);
  fails('// Stryker disable next-line StringLiteral: equivalent — why\n', /nothing to disable/);
});

test('negative: a stale disable, one rule per mutator', () => {
  const stale = [
    ['StringLiteral', 'const a = 1;'],
    ['ConditionalExpression', 'const a = 1;'],
    ['BlockStatement', 'const a = 1;'],
    ['EqualityOperator', 'const a = b => c;'],
    ['LogicalOperator', 'const a = b;'],
    ['BooleanLiteral', 'const a = 1;'],
    ['ArithmeticOperator', 'const a = b;'],
    ['MethodExpression', 'const a = b.length;'],
    ['OptionalChaining', 'const a = b.c;'],
    ['CallExpression', 'const a = b;'],
  ];
  for (const [mutator, line] of stale)
    fails(`// Stryker disable next-line ${mutator}: equivalent — why\n${line}`, /stale/);
});

test('a string that only quotes a construct does not satisfy another mutator', () => {
  fails('// Stryker disable next-line LogicalOperator: equivalent — why\nconst a = "x && y";', /stale/);
  fails('// Stryker disable next-line OptionalChaining: equivalent — why\nconst a = b; // c?.d', /stale/);
});

test('a product file that imports a testing/ file fails', () => {
  // The real tree is clean (checked above); a fixture directory proves the rule fires.
  assert.deepEqual(
    testingFolderProblems(new URL('./fixtures/api-testing-folder', import.meta.url).pathname),
    ['modules/x/application/use-case.ts (product) imports modules/x/application/testing/fake-x.ts'],
  );
});
