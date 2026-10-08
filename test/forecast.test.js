import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestWindow,
  computeForecastValues,
  dayKey,
  dayProfile,
  dayRange,
  energyBetween,
  formatTime,
  interpolate,
  maxPowerBetween,
  nextDayKey,
  toPoints,
} from '../src/forecast.js';
import { ESTIMATE } from './helpers/fixtures.js';

const forecast = {
  watts: ESTIMATE.result.watts,
  wattHours: ESTIMATE.result.watt_hours,
  wattHoursDay: ESTIMATE.result.watt_hours_day,
  timezone: 'Europe/Paris',
};

test('interpolate is linear between two points and fixed outside', () => {
  const points = [
    [0, 0],
    [10, 100],
  ];
  assert.equal(interpolate(points, 5), 50);
  assert.equal(interpolate(points, 10), 100);
  assert.equal(interpolate(points, -1, { before: 7 }), 7);
  assert.equal(interpolate(points, 11, { after: 9 }), 9);
  assert.equal(interpolate([], 3), 0);
});

test('toPoints sorts the series by time', () => {
  const points = toPoints({ '2026-10-02T10:00:00+02:00': 2, '2026-10-02T09:00:00+02:00': 1 });
  assert.deepEqual(
    points.map(([, v]) => v),
    [1, 2],
  );
});

test('dayKey uses the timezone of the plane', () => {
  // 23:30 UTC on Oct 2 is already Oct 3 in Paris.
  assert.equal(dayKey(new Date('2026-10-02T23:30:00Z'), 'Europe/Paris'), '2026-10-03');
  assert.equal(dayKey(new Date('2026-10-02T23:30:00Z'), 'UTC'), '2026-10-02');
});

test('nextDayKey handles month ends and DST days', () => {
  assert.equal(nextDayKey('2026-10-31'), '2026-11-01');
  assert.equal(nextDayKey('2026-03-28'), '2026-03-29');
  assert.equal(nextDayKey('2026-12-31'), '2027-01-01');
});

test('values in the afternoon', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-02T15:00:00+02:00'));
  assert.deepEqual(values, {
    powerNow: 710,
    energyToday: 5.35,
    energyRemainingToday: 2, // 5354 - 3353 Wh
    energyTomorrow: 4.51,
  });
});

test('power is interpolated between two forecast points', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-02T15:30:00+02:00'));
  assert.equal(values.powerNow, 729); // (710 + 748) / 2
});

test('values before sunrise and after sunset', () => {
  const night = computeForecastValues(forecast, new Date('2026-10-02T05:00:00+02:00'));
  assert.equal(night.powerNow, 0);
  assert.equal(night.energyRemainingToday, 5.35);

  const evening = computeForecastValues(forecast, new Date('2026-10-02T22:00:00+02:00'));
  assert.equal(evening.powerNow, 0);
  assert.equal(evening.energyRemainingToday, 0);
  assert.equal(evening.energyToday, 5.35);
});

test('a cache from yesterday still gives today but not tomorrow', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-03T12:00:00+02:00'));
  assert.equal(values.energyToday, 4.51);
  assert.equal(values.energyTomorrow, null);
  assert.equal(values.powerNow, 557);
});

test('a forecast that is far too old gives no value', () => {
  const values = computeForecastValues(forecast, new Date('2026-10-10T12:00:00+02:00'));
  assert.deepEqual(values, {
    powerNow: null,
    energyToday: null,
    energyRemainingToday: null,
    energyTomorrow: null,
  });
});

const at = (iso) => new Date(iso).getTime();

test('energyBetween matches the watt_hours_period of Forecast.Solar', () => {
  // Period ending at 09:00: 177 Wh, at 10:00: 332 Wh.
  const wh = energyBetween(
    forecast,
    at('2026-10-02T08:00:00+02:00'),
    at('2026-10-02T10:00:00+02:00'),
  );
  assert.equal(wh, 177 + 332);
});

test('energyBetween over a whole day equals the daily total', () => {
  const wh = energyBetween(
    forecast,
    at('2026-10-02T00:00:00+02:00'),
    at('2026-10-03T00:00:00+02:00'),
  );
  assert.ok(Math.abs(wh - 5354) < 5, `got ${wh}`);
});

test('maxPowerBetween finds the highest point inside the range', () => {
  assert.equal(
    maxPowerBetween(forecast, at('2026-10-02T14:30:00+02:00'), at('2026-10-02T18:00:00+02:00')),
    748,
  );
});

test('dayProfile gives start, peak and end of the production', () => {
  const profile = dayProfile(forecast, '2026-10-02');
  assert.equal(profile.start, at('2026-10-02T07:51:39+02:00'));
  assert.equal(profile.end, at('2026-10-02T19:28:11+02:00'));
  assert.equal(profile.peakTime, at('2026-10-02T16:00:00+02:00'));
  assert.equal(profile.peakPower, 748);
  assert.equal(dayProfile(forecast, '2026-10-09'), null);
});

test('bestWindow finds the sunniest slot', () => {
  const window = bestWindow(forecast, {
    from: at('2026-10-02T06:00:00+02:00'),
    to: at('2026-10-02T21:00:00+02:00'),
    durationMs: 2 * 3600 * 1000,
  });
  // 14:30 → 16:30 around the 16:00 peak: about 1423 Wh (14:45 → 16:45: 1411 Wh).
  assert.equal(window.start, at('2026-10-02T14:30:00+02:00'));
  assert.ok(window.energyWh > 1300);
});

test('bestWindow returns null when nothing is produced', () => {
  assert.equal(
    bestWindow(forecast, {
      from: at('2026-10-02T20:00:00+02:00'),
      to: at('2026-10-02T23:00:00+02:00'),
      durationMs: 3600 * 1000,
    }),
    null,
  );
});

test('formatTime uses the timezone of the plane', () => {
  assert.equal(formatTime(at('2026-10-02T14:05:00Z'), 'Europe/Paris'), '16:05');
});

test('dayRange covers the forecast points of a day', () => {
  assert.deepEqual(dayRange(forecast, '2026-10-03'), {
    from: at('2026-10-03T07:53:07+02:00'),
    to: at('2026-10-03T19:26:05+02:00'),
  });
});

test('power is unknown, not 0 W, past the last forecast point', () => {
  // Last point of the fixture: 2026-10-03T19:26:05+02:00 (tomorrow's sunset).
  const justAfter = computeForecastValues(forecast, new Date('2026-10-03T20:00:00+02:00'));
  assert.equal(justAfter.powerNow, 0, 'within the margin it is still the night');
  const later = computeForecastValues(forecast, new Date('2026-10-03T23:00:00+02:00'));
  assert.equal(later.powerNow, null);
  const nextMorning = computeForecastValues(forecast, new Date('2026-10-04T10:00:00+02:00'));
  assert.equal(nextMorning.powerNow, null);
});
