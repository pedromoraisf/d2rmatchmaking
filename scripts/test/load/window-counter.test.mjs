import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWindowCounter } from '../../load/lib/window-counter.mjs';

/** A clock the test moves by hand, in milliseconds. */
function clockAt(start = 0) {
  let time = start;
  return {
    now: () => time,
    set: (next) => {
      time = next;
    },
  };
}

test('bytes outside the window are ignored', () => {
  const clock = clockAt(1000);
  const counter = createWindowCounter(clock.now);

  counter.add(500);
  counter.start();
  counter.add(10);
  counter.add(5);
  clock.set(4000);
  assert.deepEqual(counter.stop(), { bytes: 15, seconds: 3 }, 'only the bytes inside the window count');

  counter.add(999);
  assert.deepEqual(counter.stop(), { bytes: 0, seconds: 0 }, 'bytes after stop do not reach a second stop');
});

test('stop reports the bytes and the seconds of the window', () => {
  const clock = clockAt(0);
  const counter = createWindowCounter(clock.now);
  counter.start();
  counter.add(70_000);
  clock.set(90_000);
  assert.deepEqual(counter.stop(), { bytes: 70_000, seconds: 90 });
});

test('a second start restarts the window', () => {
  const clock = clockAt(0);
  const counter = createWindowCounter(clock.now);
  counter.start();
  counter.add(10);
  clock.set(2000);
  counter.start();
  counter.add(3);
  clock.set(5000);
  assert.deepEqual(counter.stop(), { bytes: 3, seconds: 3 }, 'the earlier bytes and time are dropped');
});

test('stop without start returns zeros', () => {
  const counter = createWindowCounter(clockAt(42).now);
  counter.add(100);
  assert.deepEqual(counter.stop(), { bytes: 0, seconds: 0 });
});

test('a byte count must be a non-negative integer and the clock a function', () => {
  const counter = createWindowCounter(clockAt(0).now);
  counter.start();
  assert.throws(() => counter.add(-1), RangeError);
  assert.throws(() => counter.add(1.5), RangeError);
  assert.throws(() => counter.add(Number.NaN), RangeError);
  assert.throws(() => createWindowCounter(42), TypeError);
});
