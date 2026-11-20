// The keep-awake window rule (ADR 033, DLP-07): a daily window in a time zone, crossing midnight, start inclusive and end
// exclusive. São Paulo has no daylight saving time since 2019, so UTC-3 holds the whole year.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_WINDOW, isInsideWindow, minuteOfDay, parseWindow } from '../delivery/awake-window.mjs';

/** The instant that reads `hh:mm` in São Paulo (UTC-3) on 2026-11-20. */
const at = (hh, mm = 0) => new Date(Date.UTC(2026, 10, 20, hh + 3, mm));

test('the default window is 16:00 to 02:00 in São Paulo, ten hours a day', () => {
  assert.equal(DEFAULT_WINDOW, '16:00-02:00 America/Sao_Paulo');
  const rule = parseWindow(DEFAULT_WINDOW);
  assert.equal(((rule.endMinute - rule.startMinute + 1440) % 1440) / 60, 10);
});

test('inside from 16:00 sharp, through midnight, until just before 02:00', () => {
  for (const [hh, mm] of [
    [16, 0],
    [16, 1],
    [20, 30],
    [23, 59],
    [0, 0],
    [0, 1],
    [1, 59],
  ]) {
    assert.equal(isInsideWindow(at(hh, mm), DEFAULT_WINDOW), true, `${hh}:${mm}`);
  }
});

test('outside from 02:00 sharp until just before 16:00', () => {
  for (const [hh, mm] of [
    [2, 0],
    [2, 1],
    [9, 0],
    [12, 0],
    [15, 59],
  ]) {
    assert.equal(isInsideWindow(at(hh, mm), DEFAULT_WINDOW), false, `${hh}:${mm}`);
  }
});

test('a window inside one day works too, with the same boundaries', () => {
  const window = '09:00-17:30 America/Sao_Paulo';
  assert.equal(isInsideWindow(at(8, 59), window), false);
  assert.equal(isInsideWindow(at(9, 0), window), true);
  assert.equal(isInsideWindow(at(17, 29), window), true);
  assert.equal(isInsideWindow(at(17, 30), window), false);
  assert.equal(isInsideWindow(at(0, 0), window), false);
});

test('the time zone decides the clock: the same instant is inside in one zone and outside in another', () => {
  const instant = new Date(Date.UTC(2026, 10, 20, 12, 0));
  assert.equal(minuteOfDay(instant, 'America/Sao_Paulo'), 9 * 60);
  assert.equal(minuteOfDay(instant, 'UTC'), 12 * 60);
  assert.equal(isInsideWindow(instant, '10:00-14:00 UTC'), true);
  assert.equal(isInsideWindow(instant, '10:00-14:00 America/Sao_Paulo'), false);
});

test('a window that follows daylight saving time follows the local clock', () => {
  const summer = new Date(Date.UTC(2026, 6, 1, 15, 30));
  const winter = new Date(Date.UTC(2026, 0, 1, 15, 30));
  assert.equal(isInsideWindow(summer, '11:00-12:00 America/New_York'), true);
  assert.equal(isInsideWindow(winter, '11:00-12:00 America/New_York'), false);
});

test('an unset, empty, malformed or zero-length window means the default', () => {
  for (const bad of [
    undefined,
    null,
    '',
    '   ',
    '16-02 America/Sao_Paulo',
    '25:00-02:00 UTC',
    '16:00-02:00',
    '16:00-02:00 Not/AZone',
    '08:00-08:00 UTC',
    'x',
  ]) {
    assert.equal(parseWindow(bad), undefined, String(bad));
    assert.equal(isInsideWindow(at(20), bad), true, `${bad} at 20:00`);
    assert.equal(isInsideWindow(at(9), bad), false, `${bad} at 09:00`);
  }
});
