import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PLAYERS, playerFor, runIdFrom } from '../../load/lib/players.mjs';

const NAME_PATTERN = /^[A-Za-z0-9]{2,16}$/;
const RUN_ID = 'k7q2mz9a';

test('unique names and distinct addresses', () => {
  const names = new Set();
  const lowered = new Set();
  const addresses = new Set();
  for (let index = 0; index < MAX_PLAYERS; index += 1) {
    const { name, address } = playerFor(RUN_ID, index);
    assert.match(name, NAME_PATTERN, `player ${index} has a name of 2 to 16 letters and digits`);
    names.add(name);
    lowered.add(name.toLowerCase());
    addresses.add(address);

    const octets = address.split('.').map(Number);
    assert.equal(octets.length, 4, `player ${index} has an IPv4 address`);
    assert.ok(octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255));
    assert.equal(octets[0], 10, `player ${index} sits in 10.0.0.0/8`);
  }
  assert.equal(names.size, MAX_PLAYERS, 'every name is unique');
  assert.equal(lowered.size, MAX_PLAYERS, 'names are unique case-insensitively');
  assert.equal(addresses.size, MAX_PLAYERS, 'every player has its own client address');

  assert.notEqual(playerFor(RUN_ID, 0).name, playerFor('zzzzzzzz', 0).name, 'a run id separates the names');
  assert.equal(playerFor(RUN_ID, 7).name, playerFor(RUN_ID, 7).name, 'the same index gives the same name');
});

test('the index and the run id are checked', () => {
  assert.throws(() => playerFor(RUN_ID, MAX_PLAYERS), RangeError, 'index 400 is past the ceiling');
  assert.throws(() => playerFor(RUN_ID, -1), RangeError);
  assert.throws(() => playerFor(RUN_ID, 1.5), RangeError);
  assert.throws(() => playerFor('K7Q2MZ9A', 0), TypeError, 'a run id is lower-case');
  assert.throws(() => playerFor('short', 0), TypeError);
});

test('runIdFrom returns eight characters from a-z0-9', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  assert.equal(
    runIdFrom(() => 0),
    'aaaaaaaa',
    'index 0 is a',
  );
  assert.equal(
    runIdFrom(() => 35),
    '99999999',
    'index 35 is the last digit',
  );
  assert.equal(
    runIdFrom(() => 26),
    '00000000',
    'index 26 starts the digits',
  );

  // Indices 0, 25, 26, 35, 13, 7, 1, 30 of a-z then 0-9 are a, z, 0, 9, n, h, b, 4.
  const sequence = [0, 25, 26, 35, 13, 7, 1, 30];
  let position = 0;
  const id = runIdFrom(() => sequence[position++]);
  assert.equal(id, 'az09nhb4', 'each draw picks one character of the alphabet, in order');
  assert.match(id, /^[a-z0-9]{8}$/);
  for (const character of id) {
    assert.ok(alphabet.includes(character));
  }

  assert.throws(() => runIdFrom(() => 36), RangeError, 'an index past the alphabet is refused');
  assert.throws(() => runIdFrom(() => 0.5), RangeError, 'a fraction is refused');
});
