import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextStep, profileFor } from '../../load/lib/profile.mjs';

test('full profile steps', () => {
  const full = profileFor('full');
  assert.equal(full.profile, 'full');
  assert.deepEqual(
    full.steps.map((step) => step.players),
    [25, 50, 100, 150, 200, 300, 400],
  );
  for (const step of full.steps) {
    assert.equal(step.rampSeconds, 20);
    assert.equal(step.holdSeconds, 120);
    assert.equal(step.windowSeconds, 90, 'the measuring window is the last 90 s of the hold');
    assert.deepEqual(step.windowInHold, { start: 30, end: 120 }, '30 s into the hold to the end of the hold');
    assert.deepEqual(
      step.windowOffsets,
      { start: 50, end: 140 },
      'the same window on the clock of k6, after the ramp',
    );
  }
});

test('no next step after a failure or the last step', () => {
  const first = nextStep('full', []);
  assert.equal(first.players, 25, 'the first step runs first');

  const afterPass = nextStep('full', [{ passed: true }, { passed: true }]);
  assert.equal(afterPass.players, 100, 'the next step follows the passed ones');

  assert.equal(nextStep('full', [{ passed: true }, { passed: false }]), null, 'a failed step ends the run');
  assert.equal(nextStep('full', [{ passed: false }]), null, 'a failed first step ends the run');

  const every = Array.from({ length: 7 }, () => ({ passed: true }));
  assert.equal(nextStep('full', every), null, 'after the 400-player step there is no next step');

  assert.throws(() => nextStep('full', [{}]), TypeError, 'a result without a passed flag is refused');
});

test('smoke profile', () => {
  const smoke = profileFor('smoke');
  assert.equal(smoke.profile, 'smoke');
  assert.equal(smoke.steps.length, 1);
  const [step] = smoke.steps;
  assert.equal(step.players, 5);
  assert.equal(step.holdSeconds, 30);
  assert.equal(step.rampSeconds, 20);
  assert.equal(step.windowSeconds, 30, 'a 30 s hold has no 90 s window: the window is the whole hold');
  assert.deepEqual(step.windowOffsets, { start: 20, end: 50 });

  assert.equal(nextStep('smoke', []).players, 5);
  assert.equal(nextStep('smoke', [{ passed: true }]), null, 'the smoke profile has no step after its one');
});

test('an unknown profile is refused', () => {
  assert.throws(() => profileFor('stress'), TypeError);
});
